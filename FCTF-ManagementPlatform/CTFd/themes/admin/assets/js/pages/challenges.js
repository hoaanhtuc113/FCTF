import "./main";
import CTFd from "../compat/CTFd";
import $ from "jquery";
import "../compat/json";
import { ezAlert, ezQuery, ezToast } from "../compat/ezq";

// Vue tag picker
import Vue from "vue";
import { createApp } from "vue";
import TagsList from "../components/tags/TagsList.vue";

function deleteSelectedChallenges(_event) {
  let challengeIDs = $("input[data-challenge-id]:checked").map(function () {
    return $(this).data("challenge-id");
  });
  let target = challengeIDs.length === 1 ? "challenge" : "challenges";

  ezQuery({
    title: "Delete Challenges",
    body: `Are you sure you want to delete ${challengeIDs.length} ${target}?`,
    success: function () {
      const reqs = [];
      for (var chalID of challengeIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/challenges/${chalID}`, {
            method: "DELETE",
          }),
        );
      }
      Promise.all(reqs).then((_responses) => {
        window.location.reload();
      });
    },
  });
}

function bulkEditChallenges(_event) {
  let challengeIDs = $("input[data-challenge-id]:checked").map(function () {
    return $(this).data("challenge-id");
  });

  ezAlert({
    title: "Edit Challenges",
    body: $(`
    <form id="challenges-bulk-edit">
      <div class="form-group">
        <label>Category</label>
        <input type="text" name="category" data-initial="" value="">
      </div>
      <div class="form-group">
        <label>Value</label>
        <input type="number" name="value" data-initial="" value="">
      </div>
      <div class="form-group">
        <label>State</label>
        <select name="state" data-initial="">
          <option value="">--</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
    </form>
    `),
    button: "Submit",
    success: function () {
      let data = $("#challenges-bulk-edit").serializeJSON(true);
      const reqs = [];
      for (var chalID of challengeIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/challenges/${chalID}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          }),
        );
      }
      Promise.all(reqs).then((_responses) => {
        window.location.reload();
      });
    },
  });
}

function previewChallenge(challengeId, triggerEl = null) {
  const previewButton = triggerEl || document.getElementById(`preview-button-${challengeId}`);

  // const result = confirm("The domain will be immediately returned to you, but it won't be accessible until the environment finishes starting up.\nWould you like to proceed?");
  // if (!result) {
  //   return;
  // }

  // Prepare UI
  if (previewButton) {
    previewButton.disabled = true;
  }

  CTFd.fetch('/api/challenge/start', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId })
  })
  .then(response => response.json())
  .then(data => {
    console.log(data);

    if (!data || !data.success) {
      const errorMsg = (data && data.message) || 'Failed to Preview challenge.';
      
      ezAlert({
        title: `Preview Challenge ${challengeId} Error`,
        body: errorMsg,
        button: "OK"
      });
      return;
    }

    let challengeUrl = data.challenge_url || null;

    if (!challengeUrl && data.challenge_url) {
      try {
        const cacheData = typeof data.Challenge_url === 'string'
          ? JSON.parse(data.Challenge_url)
          : data.Challenge_url;
        challengeUrl = (cacheData && (cacheData.challenge_url || cacheData.Challenge_url)) || null;
      } catch (e) {
        ezAlert({
          title: `Preview Challenge ${challengeId} Error`,
          body: "Error parsing cached data.",
          button: "OK"
        });
        return;
      }
    }

    if (challengeUrl) {
      
      const body = `<div>
        <p><strong>${data.message}</strong></p>
        <div style="overflow:auto; max-width:100%; word-break:break-all;">
          <p>Challenge Token: <code>${data.challenge_url}</code></p>
        </div>
      </div>`;

      ezAlert({
        title: `Preview Challenge ${challengeId} Success`,
        body: body,
        button: "OK"
      });
    } else {
      const waitingDialog = ezAlert({
        title: `Preview Challenge ${challengeId}`,
        body: data.message,
        button: "OK"
      });
      
      // Store dialog reference for closing later
      window[`previewDialog_${challengeId}`] = waitingDialog;
    }

    // Start checking status with the original challengeId parameter
    LoopCheckingStatus(challengeId);
  })
  .catch(error => {
    console.error(error);
    
    ezAlert({
      title: "Connection Error",
      body: "Failed to connect to the server. Please try again.",
      button: "OK"
    });
  })
  .finally(() => {
    if (previewButton) {
      previewButton.disabled = false;
    }
  });
}

function startSharedChallenge(challengeId, triggerEl = null) {
  const startButton = triggerEl || null;
  if (startButton) {
    startButton.classList.add("disabled");
    startButton.style.pointerEvents = "none";
  }

  CTFd.fetch('/api/challenge/start', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, team_id: -2 })
  })
    .then(response => response.json())
    .then(data => {
      if (!data || !data.success) {
        ezAlert({
          title: `Start Challenge ${challengeId} Error`,
          body: (data && data.message) || 'Failed to start shared instance.',
          button: "OK"
        });
        return;
      }

      const body = `<div>
        <p><strong>${data.message || "Shared challenge start requested."}</strong></p>
        ${data.challenge_url ? `<div style="overflow:auto; max-width:100%; word-break:break-all;"><p>Challenge URL: <code>${data.challenge_url}</code></p></div>` : ""}
      </div>`;

      ezAlert({
        title: `Start Challenge ${challengeId} Success`,
        body,
        button: "OK"
      });
    })
    .catch(error => {
      ezAlert({
        title: "Connection Error",
        body: error?.message || "Failed to connect to the server. Please try again.",
        button: "OK"
      });
    })
    .finally(() => {
      if (startButton) {
        startButton.classList.remove("disabled");
        startButton.style.pointerEvents = "";
      }
    });
}

function closeAllActionMenus() {
  document.querySelectorAll('.action-menu.open').forEach(function (menu) {
    menu.classList.remove('open');
  });
}

function toggleActionMenu(btn, event) {
  event.stopPropagation();
  const menu = btn.nextElementSibling;
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  closeAllActionMenus();
  if (!isOpen) {
    menu.classList.add('open');
    positionActionMenu(menu, btn);
  }
}

function positionActionMenu(menu, btn) {
  const rect = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth || 170;
  const menuH = menu.offsetHeight || 160;
  let left = rect.right - menuW;
  if (left < 4) left = rect.left;

  // Flip upward if bottom space is insufficient
  const spaceBelow = window.innerHeight - rect.bottom;
  let top = rect.bottom + 6;
  if (spaceBelow < menuH + 10) {
    top = rect.top - menuH - 6;
  }

  // Keep menu fully inside viewport
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (left + menuW > window.innerWidth - 4) left = window.innerWidth - menuW - 4;

  menu.style.position = 'fixed';
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
}

function LoopCheckingStatus(challengeId) {
  // Initialize the flag at the start
  if (!window[`successShown_${challengeId}`]) {
    window[`successShown_${challengeId}`] = false;
  }
  
  var timesChecked = 0;
  var maxChecks = 40; 

  const intervalId = setInterval(() => {
    // Stop if already shown success
    if (window[`successShown_${challengeId}`]) {
      clearInterval(intervalId);
      return;
    }
    
    CheckingStatus(challengeId, intervalId).then(isReady => {
      if (isReady) {
        clearInterval(intervalId);
      }
      timesChecked += 1;

      if (timesChecked >= maxChecks) {
        clearInterval(intervalId);
        ezToast({
          title: `Preview Challenge ${challengeId} Error`,
          body: "Some things went wrong. Please try again.",
        });
      }
    });
  }, 2000);
}

function CheckingStatus(challengeId, intervalId) {
  return CTFd.fetch('/api/challenge/status-check/' + challengeId, { method: 'GET' })
    .then(response => response.json())
    .then(data => {
      console.log(data);

      if (!data || !data.success) {
        const errorMsg = (data && data.message) || 'Failed to check challenge status.';
        return false;
      }

      // Only show toast if success alert hasn't been shown yet
      if (!window[`successShown_${challengeId}`]) {
        ezToast({
          title: `Preview Challenge ${challengeId}`,
          body: data.message,
        });
      }

      if (data.challenge_url && !window[`successShown_${challengeId}`]) {
        // Set flag FIRST to prevent any race conditions
        window[`successShown_${challengeId}`] = true;
        
        // Close the waiting dialog if it exists
        const waitingDialog = window[`previewDialog_${challengeId}`];
        if (waitingDialog && typeof waitingDialog.modal === 'function') {
          try {
            waitingDialog.modal('hide');
          } catch (e) {
            console.log('Could not close waiting dialog:', e);
          }
        }
        
        // Clear interval immediately
        if (intervalId) {
          clearInterval(intervalId);
        }
        
        const body = `<div>
                      <p><strong>${data.message}</strong></p>
                      <div style="overflow:auto; max-width:100%; word-break:break-all;">
                        <p>Challenge URL: <code>${data.challenge_url}</code></p>
                      </div>
                    </div>`;

        ezAlert({
          title: `Preview Challenge ${challengeId} Success`,
          body: body,
          button: "OK"
        });
        
        return true;
      }

      return data.challenge_url ? true : false;
    })
    .catch(error => {
      console.error(error);
      return false;
    });
}

$(() => {
  $("#challenges-delete-button").click(deleteSelectedChallenges);
  $("#challenges-edit-button").click(bulkEditChallenges);

  // Mount tag picker if present (use same Vue.extend pattern as challenge page for compatibility)
  const pickerEl = document.getElementById("tags-picker");
  console.debug("Tags picker: found element?", !!pickerEl);
  if (pickerEl) {
    const initTags = pickerEl.dataset.initTags || "";
    console.debug("Tags picker: initTags=", initTags);
    try {
      const TagList = Vue.extend(TagsList);
      let vueContainer = document.createElement("div");
      pickerEl.appendChild(vueContainer);
      new TagList({ propsData: { picker: true, initial_tags: initTags } }).$mount(vueContainer);
      console.debug("Tags picker mounted successfully (Vue.extend)");

      // Prevent Enter key from submitting the form when focus is inside the tag picker
      document.addEventListener('keydown', (e) => {
        try {
          if (e.key === 'Enter' && pickerEl.contains(document.activeElement)) {
            // Let the Vue component handle adding the tag; do not submit the form
            e.preventDefault();
          }
        } catch (err) {
          console.error('Error handling tag picker keydown state', err);
        }
      });

    } catch (err) {
      console.error("Failed to mount TagsList picker", err);
      const indicator = document.createElement("div");
      indicator.className = "text-danger small mt-1";
      indicator.innerText = "Tag picker failed to load (see console).";
      pickerEl.parentNode && pickerEl.parentNode.appendChild(indicator);
    }
  } else {
    console.debug("Tags picker: element not present in DOM");
  }

  document.addEventListener('click', function () {
    closeAllActionMenus();
  });

  (function () {
    function repositionOpenMenu() {
      const menu = document.querySelector('.action-menu.open');
      if (!menu) return;
      const btn = menu.previousElementSibling;
      if (btn) positionActionMenu(menu, btn);
    }
    const tableWrapper = document.querySelector('.clean-table-wrapper');
    if (tableWrapper) tableWrapper.addEventListener('scroll', repositionOpenMenu);
    window.addEventListener('scroll', repositionOpenMenu);
  })();
});

// Expose functions to global scope
window.previewChallenge = previewChallenge;
window.startSharedChallenge = startSharedChallenge;
window.CheckingStatus = CheckingStatus;
window.toggleActionMenu = toggleActionMenu;
window.closeAllActionMenus = closeAllActionMenus;
