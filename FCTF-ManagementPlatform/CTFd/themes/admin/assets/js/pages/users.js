import $ from "jquery";
import CTFd from "../compat/CTFd";
import { ezAlert, ezQuery } from "../compat/ezq";
import "../compat/json";
import "./main";

// Check if CTF is currently active
async function isCtfActive() {
  try {
    const response = await CTFd.fetch("/api/v1/configs/start", {
      method: "GET",
      credentials: "same-origin",
    });
    const startConfig = await response.json();
    
    const endResponse = await CTFd.fetch("/api/v1/configs/end", {
      method: "GET",
      credentials: "same-origin",
    });
    const endConfig = await endResponse.json();
    
    if (!startConfig.success || !endConfig.success) {
      return false;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const start = startConfig.data?.value ? parseInt(startConfig.data.value) : 0;
    const end = endConfig.data?.value ? parseInt(endConfig.data.value) : 0;
    console.log("CTF Start:", start, "End:", end, "Now:", now);
    // CTF is active if started and not ended
    if (start > 0 && end > 0) {
      return start < now && now < end;
    }
    if (start > 0 && end === 0) {
      return now > start;
    }
    return false;
  } catch (err) {
    console.error("Error checking CTF status:", err);
    return false;
  }
}

function deleteSelectedUsers(_event) {
  let userIDs = $("input[data-user-id]:checked").map(function () {
    return $(this).data("user-id");
  });
  let target = userIDs.length === 1 ? "user" : "users";

  ezQuery({
    title: "Delete Users",
    body: `Are you sure you want to delete ${userIDs.length} ${target}?`,
    success: function () {
      const reqs = [];
      for (var userID of userIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/users/${userID}`, {
            method: "DELETE",
          })
        );
      }
      Promise.all(reqs).then((_responses) => {
        window.location.reload();
      });
    },
  });
}

async function exportUsers(includePasswords = false) {
  const exportBtn = $("#export-btn");
  const originalText = exportBtn.text();
  
  try {
    // Disable button and show loading state
    exportBtn.prop("disabled", true).text("Exporting...");
    
    // Close dropdown
    $("#export-csv-dropdown").removeClass("show");
    
    // Get current URL parameters (filter)
    const urlParams = new URLSearchParams(window.location.search);
    const field = urlParams.get('field');
    const q = urlParams.get('q');
    
    console.log("Export filters:", { field, q, includePasswords });
    
    // Build URL with filters
    let url = "/admin/export/csv/user";
    const params = new URLSearchParams();
    
    if (includePasswords) {
      params.append('include_passwords', '1');
    }
    if (field && q) {
      params.append('field', field);
      params.append('q', q);
    }
    
    if (params.toString()) {
      url += '?' + params.toString();
    }
    
    console.log("Export URL:", url);

    // Thông báo đang export
    CTFd.ui.ezq.ezToast({
      title: "Export Started",
      body: includePasswords
        ? "Resetting passwords and preparing CSV..."
        : "Preparing CSV for download...",
    });

    // Gọi API backend
    const response = await CTFd.fetch(url, {
      method: "GET",
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(`Export failed (${response.status})`);
    }

    // Tạo blob từ response
    const blob = await response.blob();
    const contentDisposition = response.headers.get("Content-Disposition");
    const fileNameMatch = contentDisposition && contentDisposition.match(/filename="?([^"]+)"?/);
    const fileName = fileNameMatch ? fileNameMatch[1] : "users.csv";

    // Tự động tải file
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);

    // Hoàn tất
    CTFd.ui.ezq.ezToast({
      title: "Export Complete",
      body: includePasswords
        ? "User CSV (with reset passwords) downloaded successfully."
        : "User CSV downloaded successfully.",
    });
  } catch (err) {
    console.error(err);
    CTFd.ui.ezq.ezToast({
      title: "Export Failed",
      body: err.message,
    });
  } finally {
    // Re-enable button
    exportBtn.prop("disabled", false).text(originalText);
  }
}

function bulkEditUsers(_event) {
  let userIDs = $("input[data-user-id]:checked").map(function () {
    return $(this).data("user-id");
  });

  ezAlert({
    title: "Edit Users",
    body: $(` 
    <form id="users-bulk-edit">
      <div id="Verified" class="form-group Verified">
        <label>Verified</label>
        <select name="verified" data-initial="">
          <option value="">--</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
      <div class="form-group">
        <label>Banned</label>
        <select name="banned" data-initial="">
          <option value="">--</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
      <div id="Hidden" class="form-group Hidden">
        <label>Hidden</label>
        <select name="hidden" data-initial="">
          <option value="">--</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
    </form>
    `),
    button: "Submit",
    success: function () {
      let data = $("#users-bulk-edit").serializeJSON(true);
      const reqs = [];
      for (var userID of userIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/users/${userID}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          })
        );
      }
      Promise.all(reqs).then((_responses) => {
        window.location.reload();
      });
    },
  });
  const isJury = document.querySelector("#is_jury").value === "true";

  if (isJury) {
    document.querySelector("#Verified").style.display = "none";
    document.querySelector("#Hidden").style.display = "none";
  }
}


$(() => {
  $("#export-btn").on("click", async function () {
    const includePasswords = $("#include-passwords-visible").is(":checked");
    
    // Check if CTF is active when trying to export with passwords
    if (includePasswords) {
      const ctfActive = await isCtfActive();
      console.log("CTF Active check:", ctfActive);
      if (ctfActive) {
        ezAlert({
          title: "Export Restricted",
          body: "Cannot export users with passwords while CTF is active. Please export without passwords or wait until CTF ends.",
          button: "OK",
        });
        return;
      }
    }
    
    exportUsers(includePasswords);
  });
  
  $("#users-delete-button").click(deleteSelectedUsers);
  $("#users-edit-button").click(bulkEditUsers);
  
  $("#export-csv-button").on("click", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dropdown = $("#export-csv-dropdown");
    const isShowing = dropdown.hasClass("show");
    
    // Toggle dropdown
    dropdown.toggleClass("show");
    
    // If showing, check CTF status
    if (!isShowing) {
      console.log("Checking CTF status for password export...");
      const ctfActive = await isCtfActive();
      console.log("CTF is active:", ctfActive);
      
      if (ctfActive) {
        $("#ctf-active-warning").show();
        $("#include-passwords-visible").prop("disabled", true).prop("checked", false);
      } else {
        $("#ctf-active-warning").hide();
        $("#include-passwords-visible").prop("disabled", false);
      }
    }
  });

  $("#include-passwords-visible").on("change", async function (e) {
    e.stopPropagation();
    
    if ($(this).is(":checked")) {
      const ctfActive = await isCtfActive();
      if (ctfActive) {
        ezAlert({
          title: "Warning",
          body: "CTF is currently active. You will not be able to export with passwords until the CTF ends.",
          button: "OK",
        });
        // Uncheck the checkbox
        $(this).prop("checked", false);
        return;
      }
      
      ezAlert({
        title: "Warning",
        body: "All contestant passwords will be reset and displayed in the file.",
        button: "OK",
      });
    }
  });

  $("#export-csv-dropdown").on("click", function (e) {
    e.stopPropagation();
  });
  
  // Close dropdown when clicking outside
  $(document).on("click", function (e) {
    if (!$(e.target).closest("#export-csv-button, #export-csv-dropdown").length) {
      $("#export-csv-dropdown").removeClass("show");
    }
  });
});
