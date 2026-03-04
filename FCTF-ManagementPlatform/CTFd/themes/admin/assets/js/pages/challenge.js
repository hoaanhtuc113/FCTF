import { htmlEntities } from "@ctfdio/ctfd-js/utils/html";
import "bootstrap/js/dist/tab";
import $ from "jquery";
import Vue from "vue";
import CTFd from "../compat/CTFd";
import { ezAlert, ezQuery, ezToast } from "../compat/ezq";
import { default as helpers } from "../compat/helpers";
import "../compat/json";
import CommentBox from "../components/comments/CommentBox.vue";
import ChallengeFilesList from "../components/files/ChallengeFilesList.vue";
import FlagList from "../components/flags/FlagList.vue";
import HintsList from "../components/hints/HintsList.vue";
import NextChallenge from "../components/next/NextChallenge.vue";
import Requirements from "../components/requirements/Requirements.vue";
import TagsList from "../components/tags/TagsList.vue";
import TopicsList from "../components/topics/TopicsList.vue";
import { bindMarkdownEditors } from "../styles";
import "./main";

// Validation: Challenge name character counter and limit
function initNameValidation() {
  const nameInput = document.querySelector('.chal-name');
  const charCountSpan = document.getElementById('char-count');
  
  if (nameInput && charCountSpan) {
    nameInput.addEventListener('input', function() {
      const currentLength = this.value.length;
      charCountSpan.textContent = currentLength;
      
      // Change color based on length
      const parentSmall = charCountSpan.parentElement;
      if (currentLength > 40) {
        parentSmall.classList.add('text-danger');
        parentSmall.classList.remove('text-muted', 'text-warning');
      } else if (currentLength > 35) {
        parentSmall.classList.add('text-warning');
        parentSmall.classList.remove('text-muted', 'text-danger');
      } else {
        parentSmall.classList.add('text-muted');
        parentSmall.classList.remove('text-warning', 'text-danger');
      }
      
      // Validation
      if (currentLength > 40) {
        this.setCustomValidity('Challenge name must not exceed 40 characters');
        this.classList.add('is-invalid');
      } else {
        this.setCustomValidity('');
        this.classList.remove('is-invalid');
      }
    });
  }
}

// Validation: PDF file size (max 5MB) - ONLY for create challenge form
function initFileValidation() {
  const fileInput = document.getElementById('file-upload');
  if (!fileInput) return;
  
  // Skip validation if this is the deploy form
  const deployForm = document.getElementById('challenge-deploy');
  if (deployForm && deployForm.contains(fileInput)) {
    console.log('Skipping file validation for deploy form');
    return;
  }
  
  const form = fileInput.closest('form');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  
  fileInput.addEventListener('change', function(e) {
    // Remove existing messages
    const existingError = this.parentNode.querySelector('.file-error-message');
    const existingSuccess = this.parentNode.querySelector('.file-success-message');
    if (existingError) existingError.remove();
    if (existingSuccess) existingSuccess.remove();
    
    const file = this.files[0];
    
    if (file) {
      const maxSize = 5 * 1024 * 1024; // 5MB
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      
      console.log('File selected:', file.name, 'Size:', fileSizeMB, 'MB');
      
      if (file.size > maxSize) {
        console.log('FILE TOO LARGE! Blocking submission');
        
        // Create error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger file-error-message mt-2';
        errorDiv.innerHTML = `<strong>⚠ File Too Large!</strong><br>File size (${fileSizeMB}MB) exceeds the 5MB limit. Please select a smaller file.`;
        this.parentNode.appendChild(errorDiv);
        
        // Disable submit button
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.classList.add('disabled');
          submitButton.title = 'Cannot submit: File size exceeds 5MB limit';
        }
        
        // Show alert
        ezAlert({
          title: 'File Too Large',
          body: `The selected PDF file (${fileSizeMB}MB) exceeds the 5MB limit. Please choose a smaller file before submitting.`,
          button: 'OK'
        });
      } else {
        console.log('File size OK, enabling submit');
        
        // Enable submit button
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove('disabled');
          submitButton.title = '';
        }
        
        // Show success message
        const successDiv = document.createElement('div');
        successDiv.className = 'text-success small mt-1 file-success-message';
        successDiv.textContent = `✓ ${file.name} (${fileSizeMB}MB)`;
        this.parentNode.appendChild(successDiv);
        
        // Remove success message after 3 seconds
        setTimeout(() => {
          if (successDiv && successDiv.parentNode) {
            successDiv.remove();
          }
        }, 3000);
      }
    } else {
      // No file selected, enable submit
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.classList.remove('disabled');
        submitButton.title = '';
      }
    }
  });
}

// Form submission validation - ONLY for create challenge form
function initFormValidation() {
  const forms = document.querySelectorAll('form');
  
  forms.forEach(form => {
    // Skip validation for deploy form
    if (form.id === 'challenge-deploy') {
      return;
    }
    
    form.addEventListener('submit', function(e) {
      const nameInput = this.querySelector('.chal-name');
      const fileInput = this.querySelector('#file-upload');
      let hasError = false;
      
      // Check name length
      if (nameInput && nameInput.value.length > 40) {
        e.preventDefault();
        hasError = true;
        nameInput.focus();
        nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        ezAlert({
          title: 'Validation Error',
          body: 'Challenge name must not exceed 40 characters.',
          button: 'OK'
        });
      }
      
      // Check file size - only for create form
      if (!hasError && fileInput && fileInput.files[0]) {
        const file = fileInput.files[0];
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        if (file.size > maxSize) {
          e.preventDefault();
          hasError = true;
          fileInput.focus();
          fileInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          ezAlert({
            title: 'File Size Error',
            body: `File size (${fileSizeMB}MB) exceeds the 5MB limit. Please select a smaller file.`,
            button: 'OK'
          });
        }
      }
      
      if (hasError) {
        // Prevent any other submit handlers (jQuery handlers) from running
        try {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
        } catch (err) {
          // ignore
        }
        return false;
      }
    });
  });
}

function loadChalTemplate(challenge) {
  CTFd._internal.challenge = {};
  $.getScript(CTFd.config.urlRoot + challenge.scripts.view, function () {
    let template_data = challenge.create;
    $("#create-chal-entry-div").html(template_data);
    bindMarkdownEditors();
    
    // Initialize validation for dynamically loaded create form
    initNameValidation();
    initFileValidation();

    $.getScript(CTFd.config.urlRoot + challenge.scripts.create, function () {
      $("#create-chal-entry-div form").submit(async function (event) {
        event.preventDefault();
        const form = this;
        
        // Validate before submission
        const nameInput = form.querySelector('.chal-name');
        const fileInput = form.querySelector('#file-upload');
        
        // Check name length
        if (nameInput && nameInput.value.length > 40) {
          nameInput.focus();
          nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          ezAlert({
            title: 'Validation Error',
            body: 'Challenge name must not exceed 40 characters.',
            button: 'OK'
          });
          return false;
        }
        
        // Check file size
        if (fileInput && fileInput.files[0]) {
          const file = fileInput.files[0];
          const maxSize = 5 * 1024 * 1024; // 5MB
          
          if (file.size > maxSize) {
            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
            fileInput.focus();
            fileInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            ezAlert({
              title: 'File Size Error',
              body: `File size (${fileSizeMB}MB) exceeds the 5MB limit. Please select a smaller file.`,
              button: 'OK'
            });
            return false;
          }
        }
        
        const formData = $(form).serializeArray();
        const params = formData
          .filter(item => item.name !== 'file_upload')
          .reduce((obj, item) => {
            obj[item.name] = item.value;
            return obj;
          }, {});


        try {
          // Create challenge first (JSON)
          const res = await CTFd.fetch(CTFd.config.urlRoot + "/api/v1/challenges", {
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

          const challenge_id = response.data.id;
          $("#challenge-create-options #challenge_id").val(challenge_id);

          // If there are file inputs with files, upload them using helpers.files.upload and await result
          const hasFiles = $(form)
            .find('input[type="file"]')
            .filter(function () {
              return this.files && this.files.length > 0;
            }).length;

          if (hasFiles) {
            const data = { challenge_id: challenge_id, type: "challenge" };
            try {
              const uploadResult = await helpers.files.upload(form, data);
              console.log("File upload successful", uploadResult);
            } catch (err) {
              console.error("Upload error details:", err);
              
            }
          }
          // Open modal after creation and any uploads attempted
          $("#challenge-create-options").modal();
        } catch (err) {
          console.error("Error creating challenge:", err);
          ezAlert({ title: "Error", body: "Network error", button: "OK" });
        }
      });
    });
  });
}

function handleChallengeOptions(event) {
  event.preventDefault();
  var params = $(event.target).serializeJSON(true);
  const requireDeploy = params.require_deploy === true || params.require_deploy === "true" || params.require_deploy === "on";
  let cpuLimit = 0;
  let cpuRequest = 0;
  let memoryLimit = 0;
  let memoryRequest = 0;
  let useGvisor = true;
  let maxDeployCount = parseInt(params.max_deploy_count || "0", 10);

  if (requireDeploy) {
    cpuLimit = parseInt(params.cpu_limit || "0", 10);
    cpuRequest = parseInt(params.cpu_request || "0", 10);
    memoryLimit = parseInt(params.memory_limit || "0", 10);
    memoryRequest = parseInt(params.memory_request || "0", 10);
    useGvisor = (params.use_gvisor || "true") === "true";

    if (cpuLimit < 1 || cpuLimit > 500 || cpuRequest < 1 || cpuRequest > 500) {
      ezAlert({
        title: "Validation Error",
        body: "CPU limit/request must be between 1 and 500 (mCPU).",
        button: "OK",
      });
      return;
    }

    if (memoryLimit < 1 || memoryLimit > 1024 || memoryRequest < 1 || memoryRequest > 1024) {
      ezAlert({
        title: "Validation Error",
        body: "Memory limit/request must be between 1 and 1024 (Mi).",
        button: "OK",
      });
      return;
    }
  }
  let flag_params = {
    challenge_id: params.challenge_id,
    content: params.flag || "",
    type: params.flag_type,
    data: params.flag_data ? params.flag_data : "",
  };
  // Build PATCH body for challenge update
  const patchBody = {
    state: params.state,
    max_deploy_count: maxDeployCount,
    require_deploy: requireDeploy,
  };
  if (requireDeploy) {
    patchBody.cpu_limit = cpuLimit;
    patchBody.cpu_request = cpuRequest;
    patchBody.memory_limit = memoryLimit;
    patchBody.memory_request = memoryRequest;
    patchBody.use_gvisor = useGvisor;
  } else {
    patchBody.cpu_limit = null;
    patchBody.cpu_request = null;
    patchBody.memory_limit = null;
    patchBody.memory_request = null;
    patchBody.use_gvisor = null;
  }

  // Step 1: Save flag + PATCH challenge in parallel.
  // PATCH must complete BEFORE file upload so that when handle_challenge_upload
  // creates a ChallengeVersion it reads the correct cpu/mem/gvisor from the DB.
  Promise.all([
    // Save flag
    new Promise(function (resolve, _reject) {
      if (flag_params.content.length == 0) {
        resolve();
        return;
      }
      CTFd.fetch("/api/v1/flags", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(flag_params),
      }).then(function (response) {
        resolve(response.json());
      });
    }),
    // PATCH challenge first so cpu/mem/gvisor are persisted before deploy file upload
    CTFd.fetch("/api/v1/challenges/" + params.challenge_id, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    }).then(function (response) {
      return response.json();
    }),
  ]).then(function (_responses) {
    // Step 2: Upload files AFTER PATCH has committed cpu/mem/gvisor to DB
    const btnFinish = $(event.target).find('#deploy-btn');
    btnFinish.prop('disabled', true);
    return new Promise(function (resolve, _reject) {
      try {
        let form = event.target;
        let data = {
          challenge_id: params.challenge_id,
          type: "challenge",
        };
        let filepath = $(form.elements["file"]).val();
        let deploy_file_path = $(form.elements["deploy_file"]).val();
        if (filepath || deploy_file_path) {
          helpers.files
            .upload(form, data)
            .then(() => {
              btnFinish.prop('disabled', false);
              resolve();
            })
            .catch((error) => {
              btnFinish.prop('disabled', false);
              resolve(); // Don't block redirect on upload error
            });
        } else {
          btnFinish.prop('disabled', false);
          resolve();
        }
      } catch (error) {
        btnFinish.prop('disabled', false);
        resolve();
      }
    });
  }).then(function () {
    // Step 3: Redirect to challenge detail page
    setTimeout(function () {
      window.location =
        CTFd.config.urlRoot + "/admin/challenges/" + params.challenge_id;
    }, 700);
  });
}

$(() => {
  // Initialize validations
  initNameValidation();
  initFileValidation();
  initFormValidation();
  
  $(".preview-challenge").click(function (_e) {
    let url = `${CTFd.config.urlRoot}/admin/challenges/preview/${window.CHALLENGE_ID}`;
    $("#challenge-window").html(
      `<iframe src="${url}" height="100%" width="100%" frameBorder=0></iframe>`
    );
    $("#challenge-modal").modal();
  });

  $(".comments-challenge").click(function (_event) {
    $("#challenge-comments-window").modal();
  });

  $(".delete-challenge").click(function (_e) {
    ezQuery({
      title: "Delete Challenge",
      body: `Are you sure you want to delete <strong>${htmlEntities(
        window.CHALLENGE_NAME
      )}</strong>`,
      success: function () {
        CTFd.fetch("/api/v1/challenges/" + window.CHALLENGE_ID, {
          method: "DELETE",
        })
          .then(function (response) {
            return response.json();
          })
          .then(function (response) {
            if (response.success) {
              window.location = CTFd.config.urlRoot + "/admin/challenges";
            }
          });
      },
    });
  });

  $("#challenge-update-container > form").submit(function (e) {
    e.preventDefault();
    var params = $(e.target).serializeJSON(true);

    CTFd.fetch("/api/v1/challenges/" + window.CHALLENGE_ID + "/flags", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {
        let update_challenge = function () {
          CTFd.fetch("/api/v1/challenges/" + window.CHALLENGE_ID, {
            method: "PATCH",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
          })
            .then(function (response) {
              return response.json();
            })
            .then(function (response) {
              if (response.success) {
                $(".challenge-state").text(response.data.state);
                switch (response.data.state) {
                  case "visible":
                    $(".challenge-state")
                      .removeClass("badge-danger")
                      .addClass("badge-success");
                    break;
                  case "hidden":
                    $(".challenge-state")
                      .removeClass("badge-success")
                      .addClass("badge-danger");
                    break;
                  default:
                    break;
                }
                ezToast({
                  title: "Success",
                  body: "Your challenge has been updated!",
                });
              } else {
                let body = "";
                for (const k in response.errors) {
                  body += response.errors[k].join("\n");
                  body += "\n";
                }

                ezAlert({
                  title: "Error",
                  body: body,
                  button: "OK",
                });
              }
            });
        };
        // Check if the challenge doesn't have any flags before marking visible
        if (response.data.length === 0 && params.state === "visible") {
          ezQuery({
            title: "Missing Flags",
            body: "This challenge does not have any flags meaning it may be unsolveable. Are you sure you'd like to update this challenge?",
            success: update_challenge,
          });
        } else {
          update_challenge();
        }
      });
  });

  $("#challenge-create-options form").submit(handleChallengeOptions);

  // Load FlagList component
  if (document.querySelector("#challenge-flags")) {
    const flagList = Vue.extend(FlagList);
    let vueContainer = document.createElement("div");
    document.querySelector("#challenge-flags").appendChild(vueContainer);
    new flagList({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load TopicsList component
  if (document.querySelector("#challenge-topics")) {
    const topicsList = Vue.extend(TopicsList);
    let vueContainer = document.createElement("div");
    document.querySelector("#challenge-topics").appendChild(vueContainer);
    new topicsList({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load TagsList component
  if (document.querySelector("#challenge-tags")) {
    const tagList = Vue.extend(TagsList);
    let vueContainer = document.createElement("div");
    document.querySelector("#challenge-tags").appendChild(vueContainer);
    new tagList({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load Requirements component
  if (document.querySelector("#prerequisite-add-form")) {
    const reqsComponent = Vue.extend(Requirements);
    let vueContainer = document.createElement("div");
    document.querySelector("#prerequisite-add-form").appendChild(vueContainer);
    new reqsComponent({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load ChallengeFilesList component
  if (document.querySelector("#challenge-files")) {
    const challengeFilesList = Vue.extend(ChallengeFilesList);
    let vueContainer = document.createElement("div");
    document.querySelector("#challenge-files").appendChild(vueContainer);
    new challengeFilesList({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load HintsList component
  if (document.querySelector("#challenge-hints")) {
    const hintsList = Vue.extend(HintsList);
    let vueContainer = document.createElement("div");
    document.querySelector("#challenge-hints").appendChild(vueContainer);
    new hintsList({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Load Next component
  if (document.querySelector("#next-add-form")) {
    const nextChallenge = Vue.extend(NextChallenge);
    let vueContainer = document.createElement("div");
    document.querySelector("#next-add-form").appendChild(vueContainer);
    new nextChallenge({
      propsData: { challenge_id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  // Because this JS is shared by a few pages,
  // we should only insert the CommentBox if it's actually in use
  if (document.querySelector("#comment-box")) {
    // Insert CommentBox element
    const commentBox = Vue.extend(CommentBox);
    let vueContainer = document.createElement("div");
    document.querySelector("#comment-box").appendChild(vueContainer);
    new commentBox({
      propsData: { type: "challenge", id: window.CHALLENGE_ID },
    }).$mount(vueContainer);
  }

  $.get(CTFd.config.urlRoot + "/api/v1/challenges/types", function (response) {
    const data = response.data;
    loadChalTemplate(data["standard"]);

    $("#create-chals-select input[name=type]").change(function () {
      let challenge = data[this.value];
      loadChalTemplate(challenge);
    });
  });

  // Change type of scoring
  const standardSection = $("#standard-value-section");
  const dynamicSection = $("#dynamic-value-section");
  const standardBtn = $("#standard-scoring-btn");
  const dynamicBtn = $("#dynamic-scoring-btn");

  function toggleScoringType(type) {
    if (type === "standard") {
      standardSection.removeClass("d-none");
      dynamicSection.addClass("d-none");
      standardBtn.addClass("active");
      standardBtn.find('input[type="radio"]').prop("checked", true);
      dynamicBtn.removeClass("active");
      
      standardSection.find("input").prop("disabled", false);
      standardSection.find(".chal-value").prop("required", true);
      
      dynamicSection.find("input, select").prop("disabled", true);
      dynamicSection.find(".chal-initial, .chal-decay, .chal-minimum").prop("required", false);
    } else {
      standardSection.addClass("d-none");
      dynamicSection.removeClass("d-none");
      dynamicBtn.addClass("active");
      dynamicBtn.find('input[type="radio"]').prop("checked", true);
      standardBtn.removeClass("active");
      
      standardSection.find("input").prop("disabled", true);
      standardSection.find(".chal-value").prop("required", false);
      
      dynamicSection.find("input, select").prop("disabled", false);
      dynamicSection.find(".chal-initial, .chal-decay, .chal-minimum").prop("required", true);
    }
  }

  // Initialize state on page load based on current active button
  if (dynamicBtn.hasClass("active")) {
    toggleScoringType("dynamic");
  } else {
    toggleScoringType("standard");
  }

  standardBtn.click(function (e) {
    e.preventDefault();
    // Don't allow toggle if buttons are disabled (CTF is active)
    if ($(this).hasClass('disabled') || $(this).find('input').prop('disabled')) {
      return false;
    }
    toggleScoringType("standard");
  });

  dynamicBtn.click(function (e) {
    e.preventDefault();
    // Don't allow toggle if buttons are disabled (CTF is active)
    if ($(this).hasClass('disabled') || $(this).find('input').prop('disabled')) {
      return false;
    }
    toggleScoringType("dynamic");
  });
});
