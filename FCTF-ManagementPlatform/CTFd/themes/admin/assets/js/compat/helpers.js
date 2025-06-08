import { htmlEntities } from "@ctfdio/ctfd-js/utils/html";
import { default as $, default as jQuery } from "jquery";
import { default as ezq } from "./ezq";
import { colorHash } from "./styles";
import { copyToClipboard } from "./ui";

const utils = {
  htmlEntities: htmlEntities,
  colorHash: colorHash,
  copyToClipboard: copyToClipboard,
};

const files = {
  upload: (form, extra_data) => {
    return new Promise((resolve, reject) => {
      const CTFd = window.CTFd;

      if (form instanceof jQuery) {
        form = form[0];
      }
      const formData = new FormData(form);
      formData.append("nonce", CTFd.config.csrfNonce);
      for (let [key, value] of Object.entries(extra_data)) {
        formData.append(key, value);
      }

      // Hiển thị thông báo đang tải lên

      $.ajax({
        url: CTFd.config.urlRoot + "/api/v1/files",
        data: formData,
        type: "POST",
        cache: false,
        contentType: false,
        processData: false,
        xhr: function () {
          const xhr = $.ajaxSettings.xhr();
          return xhr;
        },
        success: function (data, status, jqXHR) {
          if (jqXHR.status === 200) {
            form.reset();
            resolve();
          } else {
            console.error("Unexpected response status:", jqXHR.status);
            alert("Unexpected response status: " + jqXHR.status);
            reject(new Error("Unexpected response status: " + jqXHR.status));
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          console.error("Error during file upload:", textStatus, errorThrown);
          alert("Error during file upload: " + textStatus + " " + errorThrown);
          reject(new Error("File upload failed: " + jqXHR.statusText));
        },
      });
    });
  },
};

const comments = {
  get_comments: (extra_args) => {
    const CTFd = window.CTFd;
    return CTFd.fetch("/api/v1/comments?" + $.param(extra_args), {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }).then(function (response) {
      return response.json();
    });
  },
  add_comment: (comment, type, extra_args, cb) => {
    const CTFd = window.CTFd;
    let body = {
      content: comment,
      type: type,
      ...extra_args,
    };
    CTFd.fetch("/api/v1/comments", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {
        if (cb) {
          cb(response);
        }
      });
  },
  delete_comment: (comment_id) => {
    const CTFd = window.CTFd;
    return CTFd.fetch(`/api/v1/comments/${comment_id}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }).then(function (response) {
      return response.json();
    });
  },
};

const helpers = {
  files,
  comments,
  utils,
  ezq,
};

export default helpers;
