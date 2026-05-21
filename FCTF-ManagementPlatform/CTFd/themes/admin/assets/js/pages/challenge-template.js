/**
 * challenge-template.js
 * Handles the Challenge Template create / edit / delete flow.
 * Mirrors challenge.js but targets /api/v1/challenge_templates endpoints
 * and omits contest-specific fields (value, state, max_attempts, cooldown,
 * time_limit, next_id).
 */
import { htmlEntities } from "@ctfdio/ctfd-js/utils/html";
import "bootstrap/js/dist/tab";
import $ from "jquery";
import Vue from "vue";
import CTFd from "../compat/CTFd";
import { ezAlert, ezQuery, ezToast } from "../compat/ezq";
import { default as helpers } from "../compat/helpers";
import "../compat/json";
import ChallengeFilesList from "../components/files/ChallengeFilesList.vue";
import FlagList from "../components/flags/FlagList.vue";
import HintsList from "../components/hints/HintsList.vue";
import TagsList from "../components/tags/TagsList.vue";
import TopicsList from "../components/topics/TopicsList.vue";
import { bindMarkdownEditors } from "../styles";
import "./main";

const TEMPLATE_API = "/api/v1/challenge_templates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUploadStatus(message, variant = "info") {
  const el = document.getElementById("create-upload-status");
  if (!el) return;
  el.classList.remove("d-none", "alert-success", "alert-danger", "alert-info", "alert-warning");
  el.classList.add(`alert-${variant}`);
  el.textContent = message;
}

function clearUploadStatus() {
  const el = document.getElementById("create-upload-status");
  if (!el) return;
  el.classList.add("d-none");
  el.textContent = "";
}

// ---------------------------------------------------------------------------
// New template creation flow
// ---------------------------------------------------------------------------

// Fields that live in contests_challenges, not in challenge_templates.
const CONTEST_ONLY_FIELDS = ["value", "state", "max_attempts", "cooldown", "time_limit", "next_id"];

function stripContestFields(container) {
  CONTEST_ONLY_FIELDS.forEach(name => {
    const el = container.find(`[name="${name}"]`);
    if (!el.length) return;
    el.prop("required", false).prop("disabled", true);
    el.closest(".form-group").hide();
  });
}

function loadChalTemplate(challenge) {
  CTFd._internal.challenge = {};
  $.getScript(CTFd.config.urlRoot + challenge.scripts.view, function () {
    $("#create-chal-entry-div").html(challenge.create);
    stripContestFields($("#create-chal-entry-div"));
    bindMarkdownEditors();

    $.getScript(CTFd.config.urlRoot + challenge.scripts.create, function () {
      $("#create-chal-entry-div form").submit(async function (event) {
        event.preventDefault();
        const form = this;

        const formData = $(form).serializeArray();
        const params = formData
          .filter(item => item.name !== "file_upload")
          .reduce((obj, item) => {
            obj[item.name] = item.value;
            return obj;
          }, {});

        // Remove contest-specific fields (should not be present in template form,
        // but guard against accidental inclusion).
        ["value", "state", "max_attempts", "cooldown", "time_limit", "next_id"]
          .forEach(f => delete params[f]);

        try {
          const res = await CTFd.fetch(CTFd.config.urlRoot + TEMPLATE_API, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
          });
          const response = await res.json();
          if (!response.success) {
            let body = "";
            for (const k in response.errors) {
              body += response.errors[k].join("\n") + "\n";
            }
            ezAlert({ title: "Error", body: body, button: "OK" });
            return;
          }

          const templateId = response.data.id;
          $("#challenge-create-options #challenge_id").val(templateId);

          // Upload any files attached to the create form
          const hasFiles = $(form)
            .find('input[type="file"]')
            .filter(function () { return this.files && this.files.length > 0; }).length;

          if (hasFiles) {
            try {
              await helpers.files.upload(form, { challenge_id: templateId, type: "challenge" });
              ezToast({ title: "Upload", body: "File uploaded successfully." });
            } catch (err) {
              ezAlert({ title: "Upload failed", body: err?.message || "Could not upload file.", button: "OK" });
            }
          }

          // Open Options modal
          $("#challenge-create-options").modal();
        } catch (err) {
          ezAlert({ title: "Error", body: "Network error", button: "OK" });
        }
      });
    });
  });
}

function handleTemplateOptions(event) {
  event.preventDefault();
  clearUploadStatus();

  const params = $(event.target).serializeJSON(true);
  const requireDeploy =
    params.require_deploy === true ||
    params.require_deploy === "true" ||
    params.require_deploy === "on";

  let cpuLimit = 0, cpuRequest = 0, memoryLimit = 0, memoryRequest = 0;
  let useGvisor = true, hardenContainer = true, sharedInstant = false;

  if (requireDeploy) {
    cpuLimit     = parseInt(params.cpu_limit || "0", 10);
    cpuRequest   = parseInt(params.cpu_request || "0", 10);
    memoryLimit  = parseInt(params.memory_limit || "0", 10);
    memoryRequest = parseInt(params.memory_request || "0", 10);
    useGvisor     = (params.use_gvisor || "true") === "true";
    hardenContainer =
      params.harden_container === true ||
      params.harden_container === "true" ||
      params.harden_container === "on";
    sharedInstant =
      params.shared_instant === true ||
      params.shared_instant === "true" ||
      params.shared_instant === "on";

    if (cpuLimit < 1 || cpuRequest < 1) {
      ezAlert({ title: "Validation Error", body: "CPU limit/request must be >= 1 (mCPU).", button: "OK" });
      return;
    }
    if (memoryLimit < 1 || memoryRequest < 1) {
      ezAlert({ title: "Validation Error", body: "Memory limit/request must be >= 1 (Mi).", button: "OK" });
      return;
    }
  }

  const flagParams = {
    challenge_id: params.challenge_id,
    content: params.flag || "",
    type: params.flag_type || "static",
    data: params.flag_data || "",
  };

  // PATCH body — no state, no contest-specific fields
  const patchBody = {
    require_deploy: requireDeploy,
    shared_instant: requireDeploy ? sharedInstant : false,
  };
  if (requireDeploy) {
    Object.assign(patchBody, {
      cpu_limit: cpuLimit,
      cpu_request: cpuRequest,
      memory_limit: memoryLimit,
      memory_request: memoryRequest,
      use_gvisor: useGvisor,
      harden_container: hardenContainer,
    });
  } else {
    Object.assign(patchBody, {
      cpu_limit: null, cpu_request: null,
      memory_limit: null, memory_request: null,
      use_gvisor: null, harden_container: null,
    });
  }

  const templateId = params.challenge_id;

  Promise.all([
    // Save flag (skip if empty)
    new Promise(resolve => {
      if (!flagParams.content) { resolve(); return; }
      CTFd.fetch("/api/v1/flags", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(flagParams),
      }).then(r => resolve(r.json()));
    }),
    // PATCH template with deploy settings
    CTFd.fetch(`${TEMPLATE_API}/${templateId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    }).then(r => r.json()),
  ]).then(() => {
    const btnFinish = $(event.target).find("#deploy-btn");
    btnFinish.prop("disabled", true);

    return new Promise(resolve => {
      const form = event.target;
      const data = { challenge_id: templateId, type: "challenge" };
      const filepath = $(form.elements["file"]).val();
      const deployFilePath = $(form.elements["deploy_file"]).val();

      if (filepath || deployFilePath) {
        setUploadStatus("Uploading file(s)...", "info");
        helpers.files.upload(form, data)
          .then(() => {
            if (requireDeploy && deployFilePath) {
              setUploadStatus("Deploy request accepted. Executing workflow...", "info");
            } else {
              setUploadStatus("File upload successful.", "success");
            }
            btnFinish.prop("disabled", false);
            resolve();
          })
          .catch(err => {
            setUploadStatus(err?.message || "File upload failed.", "danger");
            btnFinish.prop("disabled", false);
            resolve();
          });
      } else {
        setUploadStatus("Template saved successfully.", "success");
        btnFinish.prop("disabled", false);
        resolve();
      }
    });
  }).then(() => {
    setTimeout(() => {
      window.location = `${CTFd.config.urlRoot}/admin/challenge-templates/${templateId}`;
    }, 1200);
  });
}

// ---------------------------------------------------------------------------
// Edit / update flow (used on the detail page)
// ---------------------------------------------------------------------------

function initUpdateForm() {
  $("#challenge-update-container > form").submit(function (e) {
    e.preventDefault();
    const params = $(e.target).serializeJSON(true);

    // Remove contest-specific fields
    ["value", "state", "max_attempts", "cooldown", "time_limit", "next_id"]
      .forEach(f => delete params[f]);

    CTFd.fetch(`${TEMPLATE_API}/${window.CHALLENGE_ID}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then(r => r.json())
      .then(response => {
        if (response.success) {
          ezToast({ title: "Updated", body: "Challenge template saved." });
        } else {
          let body = "";
          for (const k in response.errors || {}) {
            body += response.errors[k].join("\n") + "\n";
          }
          ezAlert({ title: "Error", body: body || JSON.stringify(response), button: "OK" });
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Strip contest-only fields from the update form (right column)
// ---------------------------------------------------------------------------

function stripContestFieldsFromUpdateForm() {
  const container = $("#challenge-update-container");
  if (!container.length) return;

  // Hide fields that don't belong in a template (no scoring, no state, no cooldown)
  ["cooldown", "value", "time_limit", "max_attempts", "state"].forEach(name => {
    container.find(`[name="${name}"]`).each(function () {
      $(this).prop("required", false).prop("disabled", true);
      $(this).closest(".form-group").hide();
    });
  });

  // Hide the scoring-type toggle and dynamic scoring sections
  container.find("#standard-value-section").hide();
  container.find("#dynamic-value-section").hide();
  container.find(".btn-group-toggle").closest(".form-group").hide();
}

// ---------------------------------------------------------------------------
// Deploy form handler for the template detail page
// ---------------------------------------------------------------------------

function initTemplateDeployForm() {
  const form = document.getElementById("template-deploy-form");
  if (!form) return;

  const setupDockerCheckbox = document.getElementById("tpl_setup_docker");
  const deployBtn = document.getElementById("tpl-deploy-btn");
  const statusMsg = document.getElementById("tpl-deploy-status-message");
  const exposePortContainer = document.getElementById("tpl_expose_port_container");
  const exposePortInput = document.getElementById("tpl_expose_port");
  const cpuLimitInput = document.getElementById("tpl_cpu_limit");
  const cpuRequestInput = document.getElementById("tpl_cpu_request");
  const memoryLimitInput = document.getElementById("tpl_memory_limit");
  const memoryRequestInput = document.getElementById("tpl_memory_request");
  const useGvisorInput = document.getElementById("tpl_use_gvisor");
  const connectionProtocolInput = document.getElementById("tpl_connection_protocol");
  const hardenContainerCheckbox = document.getElementById("tpl_harden_container");
  const sharedInstantCheckbox = document.getElementById("tpl_shared_instant");
  const fileInput = document.getElementById("tpl_deploy_file");

  function showStatus(msg, type) {
    statusMsg.className = `mt-3 alert alert-${type}`;
    statusMsg.textContent = msg;
    statusMsg.style.display = "block";
  }

  function updateButtonState() {
    if (setupDockerCheckbox.checked) {
      exposePortContainer.style.display = "block";
      deployBtn.disabled = exposePortInput.value === "";
      form.querySelectorAll(".tpl-deploy-resource-field").forEach(el => (el.style.display = "block"));
      form.querySelectorAll(".tpl-deploy-resource-field input, .tpl-deploy-resource-field select").forEach(el => {
        el.disabled = false;
      });
    } else {
      exposePortContainer.style.display = "none";
      deployBtn.disabled = false;
      form.querySelectorAll(".tpl-deploy-resource-field").forEach(el => (el.style.display = "none"));
      form.querySelectorAll(".tpl-deploy-resource-field input, .tpl-deploy-resource-field select").forEach(el => {
        el.disabled = true;
      });
    }
    fileInput.disabled = false;
  }

  setupDockerCheckbox.addEventListener("change", updateButtonState);
  exposePortInput.addEventListener("input", () => {
    if (setupDockerCheckbox.checked) deployBtn.disabled = exposePortInput.value === "";
  });
  updateButtonState();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    statusMsg.style.display = "none";

    const requireDeploy = setupDockerCheckbox.checked;

    if (requireDeploy) {
      const cpuLimit = parseInt(cpuLimitInput?.value || "0", 10);
      const cpuRequest = parseInt(cpuRequestInput?.value || "0", 10);
      const memoryLimit = parseInt(memoryLimitInput?.value || "0", 10);
      const memoryRequest = parseInt(memoryRequestInput?.value || "0", 10);
      if (cpuLimit < 1 || cpuRequest < 1) {
        ezAlert({ title: "Validation Error", body: "CPU limit/request must be >= 1 (mCPU).", button: "OK" });
        return;
      }
      if (memoryLimit < 1 || memoryRequest < 1) {
        ezAlert({ title: "Validation Error", body: "Memory limit/request must be >= 1 (Mi).", button: "OK" });
        return;
      }
    }

    deployBtn.disabled = true;
    showStatus("Saving settings...", "info");

    const patchBody = {
      require_deploy: requireDeploy,
      connection_protocol: connectionProtocolInput?.value || "http",
      expose_port: requireDeploy ? parseInt(exposePortInput?.value || "0", 10) : null,
      shared_instant: requireDeploy && sharedInstantCheckbox ? sharedInstantCheckbox.checked : false,
    };

    if (requireDeploy) {
      Object.assign(patchBody, {
        cpu_limit: parseInt(cpuLimitInput.value || "0", 10),
        cpu_request: parseInt(cpuRequestInput.value || "0", 10),
        memory_limit: parseInt(memoryLimitInput.value || "0", 10),
        memory_request: parseInt(memoryRequestInput.value || "0", 10),
        use_gvisor: (useGvisorInput?.value || "true") === "true",
        harden_container: hardenContainerCheckbox ? hardenContainerCheckbox.checked : true,
      });
    } else {
      Object.assign(patchBody, {
        cpu_limit: null, cpu_request: null,
        memory_limit: null, memory_request: null,
        use_gvisor: null, harden_container: null,
      });
    }

    try {
      const res = await CTFd.fetch(`${TEMPLATE_API}/${window.CHALLENGE_ID}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const data = await res.json();

      if (!data.success) {
        let body = "";
        for (const k in data.errors || {}) body += data.errors[k].join("\n") + "\n";
        ezAlert({ title: "Error", body: body || JSON.stringify(data), button: "OK" });
        deployBtn.disabled = false;
        statusMsg.style.display = "none";
        return;
      }

      const hasFile = fileInput && fileInput.files && fileInput.files.length > 0 && fileInput.files[0].name;
      if (hasFile) {
        showStatus(`Uploading ${fileInput.files[0].name}...`, "info");
        try {
          await helpers.files.upload(form, { challenge_id: window.CHALLENGE_ID, type: "challenge" });
          showStatus("Deploy request accepted. Executing workflow...", "info");
        } catch (err) {
          showStatus(err?.message || "File upload failed.", "danger");
          deployBtn.disabled = false;
          return;
        }
      } else {
        showStatus("Deploy settings saved successfully.", "success");
      }

      deployBtn.disabled = false;
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showStatus("Network error. Please try again.", "danger");
      deployBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Delete flow
// ---------------------------------------------------------------------------

function initDeleteButton() {
  $(".delete-challenge").click(function () {
    ezQuery({
      title: "Delete Challenge Template",
      body: `Are you sure you want to delete <strong>${htmlEntities(window.CHALLENGE_NAME)}</strong>?`,
      success: function () {
        CTFd.fetch(`${TEMPLATE_API}/${window.CHALLENGE_ID}`, { method: "DELETE" })
          .then(r => r.json())
          .then(response => {
            if (response.success) {
              window.location = `${CTFd.config.urlRoot}/admin/challenge-templates`;
            }
          });
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$(() => {
  // Vue components for the edit / detail page
  if (document.getElementById("challenge-tags")) {
    new Vue({ el: "#challenge-tags", components: { TagsList }, render: h => h(TagsList, { props: { challenge_id: window.CHALLENGE_ID, apiBase: TEMPLATE_API } }) });
  }
  if (document.getElementById("challenge-flags")) {
    new Vue({ el: "#challenge-flags", components: { FlagList }, render: h => h(FlagList, { props: { challenge_id: window.CHALLENGE_ID, apiBase: TEMPLATE_API } }) });
  }
  if (document.getElementById("challenge-hints")) {
    new Vue({ el: "#challenge-hints", components: { HintsList }, render: h => h(HintsList, { props: { challenge_id: window.CHALLENGE_ID, apiBase: TEMPLATE_API } }) });
  }
  if (document.getElementById("challenge-files")) {
    new Vue({ el: "#challenge-files", components: { ChallengeFilesList }, render: h => h(ChallengeFilesList, { props: { challengeId: window.CHALLENGE_ID } }) });
  }
  if (document.getElementById("challenge-topics")) {
    new Vue({ el: "#challenge-topics", components: { TopicsList }, render: h => h(TopicsList, { props: { challenge_id: window.CHALLENGE_ID, apiBase: TEMPLATE_API } }) });
  }

  initDeleteButton();
  initUpdateForm();
  stripContestFieldsFromUpdateForm();
  initTemplateDeployForm();

  // Challenge type selector on the new.html page
  const typeRadios = document.querySelectorAll(".card-radio");
  if (typeRadios.length && document.getElementById("create-chal-entry-div")) {
    function loadSelectedType() {
      const selected = document.querySelector(".card-radio:checked");
      if (!selected) return;
      CTFd.fetch(`${TEMPLATE_API}/types`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(r => r.json())
        .then(response => {
          if (response.success) {
            loadChalTemplate(response.data[selected.value]);
          }
        });
    }

    typeRadios.forEach(r => r.addEventListener("change", loadSelectedType));
    loadSelectedType();
  }

  // Options modal submit
  $(document).on("submit", ".modal form", function (e) {
    if ($(this).closest("#challenge-create-options").length) {
      handleTemplateOptions(e);
    }
  });
});
