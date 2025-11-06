import "./main";
import CTFd from "../compat/CTFd";
import $ from "jquery";
import "../compat/json";
import { ezAlert, ezQuery, ezToast } from "../compat/ezq";

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

function previewChallenge(challengeId) {
  const errorElement = document.getElementById(`preview-error-${challengeId}`);
  const previewButton = document.getElementById(`preview-button-${challengeId}`);
  const successElement = document.getElementById(`preview-success-${challengeId}`);

  const result = confirm("The domain will be immediately returned to you, but it won't be accessible until the environment finishes starting up.\nWould you like to proceed?");
  if (!result) {
    return;
  }

  // Prepare UI
  errorElement.innerText = 'Waiting for response...';
  errorElement.style.display = 'block';
  successElement.innerText = '';
  successElement.style.display = 'none';
  previewButton.disabled = true;

  CTFd.fetch('/api/challenge/start', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId })
  })
  .then(response => response.json())
  .then(data => {
    console.log(data);

    if (!data || !data.success) {
      const errorMsg = (data && data.message) || 'Failed to Preview challenge.';
      errorElement.innerText = errorMsg;
      
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
        errorElement.innerText = 'Error parsing cached data.';
        ezAlert({
          title: `Preview Challenge ${challengeId} Error`,
          body: "Error parsing cached data.",
          button: "OK"
        });
        return;
      }
    }

    errorElement.style.display = 'none';
    if (challengeUrl) {
      successElement.innerText = challengeUrl;
      successElement.style.display = 'block';
      
      const body = `<div>
        <p><strong>${data.message}</strong></p>
        <p>Challenge URL: ${data.challenge_url}"<br>
      </div>`;

      ezAlert({
        title: `Preview Challenge ${challengeId} Success`,
        body: body,
        button: "OK"
      });
    } else {
      successElement.innerText = data.message;
      successElement.style.display = 'block';
      
      ezAlert({
        title: `Preview Challenge ${challengeId}`,
        body: data.message,
        button: "OK"
      });
    }

    // Start checking status with the original challengeId parameter
    LoopCheckingStatus(challengeId);
  })
  .catch(error => {
    console.error(error);
    errorElement.innerText = 'Connection failed.';
    
    ezAlert({
      title: "Connection Error",
      body: "Failed to connect to the server. Please try again.",
      button: "OK"
    });
  })
  .finally(() => {
    previewButton.disabled = false;
  });
}

function LoopCheckingStatus(challengeId) {
  var timesChecked = 0;
  var maxChecks = 40; 

  const intervalId = setInterval(() => {
    CheckingStatus(challengeId).then(isReady => {
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

function CheckingStatus(challengeId) {
  return CTFd.fetch('/api/challenge/status-check/' + challengeId, { method: 'GET' })
    .then(response => response.json())
    .then(data => {
      console.log(data);

      if (!data || !data.success) {
        const errorMsg = (data && data.message) || 'Failed to check challenge status.';
        ezToast({
          title: `Preview Challenge ${challengeId} Error`,
          body: errorMsg,
        });
        return false;
      }

      ezToast({
        title: `Preview Challenge ${challengeId}`,
        body: data.message,
      });

      if (data.challenge_url) {
        const body = `<div>
                      <p><strong>${data.message}</strong></p>
                      <p>Challenge URL: ${data.challenge_url}"<br>
                    </div>`;

        ezAlert({
          title: `Preview Challenge ${challengeId} Success`,
          body: body,
          button: "OK"
        });
      }

      return true;
    })
    .catch(error => {
      console.error(error);
      return false;
    });
}

$(() => {
  $("#challenges-delete-button").click(deleteSelectedChallenges);
  $("#challenges-edit-button").click(bulkEditChallenges);
});

// Expose functions to global scope
window.previewChallenge = previewChallenge;
window.CheckingStatus = CheckingStatus;
