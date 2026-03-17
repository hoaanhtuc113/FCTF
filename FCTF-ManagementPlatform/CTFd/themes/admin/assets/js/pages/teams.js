import $ from "jquery";
import CTFd from "../compat/CTFd";
import { ezAlert, ezQuery } from "../compat/ezq";
import "../compat/json";
import "./main";

function deleteSelectedTeams(_event) {
  let teamIDs = $("input[data-team-id]:checked").map(function () {
    return $(this).data("team-id");
  });
  let target = teamIDs.length === 1 ? "team" : "teams";

  ezQuery({
    title: "Delete Teams",
    body: `Are you sure you want to delete ${teamIDs.length} ${target}?`,
    success: function () {
      const reqs = [];
      for (var teamID of teamIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/teams/${teamID}`, {
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

async function bulkEditTeams(_event) {
  let teamIDs = $("input[data-team-id]:checked").map(function () {
    return $(this).data("team-id");
  });

  // Fetch brackets for teams
  let bracketOptions = `<option value="">-- No change --</option><option value="__null__">Clear bracket</option>`;
  try {
    const bracketsResp = await CTFd.fetch("/api/v1/brackets?type=teams", { method: "GET" });
    const bracketsData = await bracketsResp.json();
    (bracketsData.data || []).forEach(function (b) {
      bracketOptions += `<option value="${b.id}">${b.name}</option>`;
    });
  } catch (e) {
    console.error("Failed to load brackets", e);
  }

  ezAlert({
    title: "Edit Teams",
    body: $(`
    <form id="teams-bulk-edit">
      <div class="form-group">
        <label>Banned</label>
        <select name="banned" data-initial="">
          <option value="">--</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
      <div id="Hidden" class="form-group">
        <label>Hidden</label>
        <select name="hidden" data-initial="">
          <option value="">--</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
      <div class="form-group">
        <label>Bracket</label>
        <select name="bracket_id" data-initial="">
          ${bracketOptions}
        </select>
      </div>
    </form>
    `),
    button: "Submit",
    success: function () {
      let data = $("#teams-bulk-edit").serializeJSON(true);

      // bracket_id: empty = no change, __null__ = clear, otherwise set as integer
      if (!data.bracket_id || data.bracket_id === "") {
        delete data.bracket_id;
      } else if (data.bracket_id === "__null__") {
        data.bracket_id = null;
      } else {
        data.bracket_id = parseInt(data.bracket_id, 10);
      }

      const reqs = [];
      for (var teamID of teamIDs) {
        reqs.push(
          CTFd.fetch(`/api/v1/teams/${teamID}`, {
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
    document.querySelector("#Hidden").style.display = "none";
  }
}

$(() => {
  $("#teams-delete-button").click(deleteSelectedTeams);
  $("#teams-edit-button").click(bulkEditTeams);
});
