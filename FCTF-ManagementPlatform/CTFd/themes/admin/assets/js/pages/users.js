import $ from "jquery";
import CTFd from "../compat/CTFd";
import { ezAlert, ezQuery } from "../compat/ezq";
import "../compat/json";
import "./main";

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
  try {
    const url = includePasswords
      ? "/admin/export/csv/user?include_passwords=1"
      : "/admin/export/csv/user";

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
    $("#export-btn").on("click", function () {
      const includePasswords = $("#include-passwords-visible").is(":checked");
      exportUsers(includePasswords);
    });
  $("#users-delete-button").click(deleteSelectedUsers);
  $("#users-edit-button").click(bulkEditUsers);
  
  $("#export-csv-button").on("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    $("#export-csv-dropdown").toggleClass("show");
  });

  $("#include-passwords-visible").on("change", function (e) {
    e.stopPropagation();
    
    if ($(this).is(":checked")) {
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
});
