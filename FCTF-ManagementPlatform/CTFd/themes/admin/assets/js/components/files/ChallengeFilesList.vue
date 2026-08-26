<template>
  <div>
    <table id="filesboard" class="table table-striped">
      <thead>
        <tr>
          <td class="text-center"><b>File</b></td>
          <td class="text-center"><b>Settings</b></td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in files" :key="file.id">
          <td class="text-center">
            <a :href="fileUrl(file)">{{
              file.location.split("/").pop()
            }}</a>
          </td>

          <td class="text-center">
            <i
              v-if="isPreviewable(file.location)"
              role="button"
              class="btn-fa fas fa-eye preview-file"
              title="Preview file"
              @click="previewFile(file)"
            ></i>
            <i
              role="button"
              class="btn-fa fas fa-times delete-file"
              @click="deleteFile(file.id)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="col-md-12 mt-3">
      <form method="POST" ref="FileUploadForm" @submit.prevent="addFiles">
        <div class="form-group">
          <input
            class="form-control-file"
            id="file"
            multiple=""
            name="file"
            required=""
            type="file"
          />
          <sub class="text-muted">
            Attach multiple files using Control+Click or Cmd+Click.
          </sub>
        </div>
        <div
          v-if="uploadStatus"
          class="alert"
          :class="uploadError ? 'alert-danger' : 'alert-success'"
          role="alert"
        >
          <span v-if="isUploading" class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>
          {{ uploadStatus }}
        </div>
        <div class="form-group">
          <input
            class="btn btn-primary float-right"
            id="_submit"
            name="_submit"
            type="submit"
            :disabled="isUploading"
            :value="isUploading ? 'Uploading…' : 'Upload'"
          />
        </div>
      </form>
    </div>

    <!-- Preview overlay. Deliberately not a Bootstrap modal: this component
         is mounted inside a tab pane, and a self-contained fixed overlay
         renders the same wherever it ends up in the DOM. -->
    <div v-if="preview" class="file-preview-overlay" @click.self="closePreview()">
      <div class="file-preview-box">
        <div class="file-preview-head">
          <span class="file-preview-name">{{ preview.name }}</span>
          <span>
            <a
              class="file-preview-action"
              :href="preview.href"
              target="_blank"
              rel="noopener"
              title="Download"
            >
              <i class="fas fa-download"></i>
            </a>
            <a class="file-preview-action" role="button" title="Close" @click="closePreview()">
              <i class="fas fa-times"></i>
            </a>
          </span>
        </div>
        <div class="file-preview-body">
          <div v-if="preview.loading" class="file-preview-note">
            <i class="fas fa-spinner fa-spin mr-2"></i> Loading…
          </div>
          <div v-else-if="preview.error" class="file-preview-note">
            Could not load this file.
          </div>
          <img
            v-else-if="preview.kind === 'image'"
            :src="preview.url"
            :alt="preview.name"
          />
          <iframe v-else :src="preview.url" :title="preview.name"></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ezQuery } from "../../compat/ezq";
import { default as helpers } from "../../compat/helpers";
import CTFd from "../../compat/CTFd";

export default {
  props: {
    challenge_id: Number,
  },
  data: function () {
    return {
      files: [],
      urlRoot: CTFd.config.urlRoot,
      isUploading: false,
      uploadStatus: "",
      uploadError: false,
      preview: null,
    };
  },
  methods: {
    // Only what the browser can render on its own. An archive or binary has
    // nothing to show, so it keeps the download link and no preview icon.
    // HTML is deliberately absent: it is rendered from a blob: URL, which
    // inherits this page's origin, so an uploaded page could run script
    // against the admin session. It stays a download, as it is today.
    fileKind: function (location) {
      const ext = (location.split(".").pop() || "").toLowerCase();
      if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
        return "image";
      }
      if (["pdf", "txt", "md", "json", "csv", "log", "xml"].includes(ext)) {
        return "document";
      }
      return null;
    },
    // Attachments are read through the admin route rather than /files/, which
    // is the contestant one: that route gates anything of type "challenge" on
    // challenge visibility, CTF time and a signed token, so a challenge's own
    // brief comes back 403 for the person editing it outside those hours.
    fileUrl: function (file) {
      return `${this.urlRoot}/admin/challenges/${this.$props.challenge_id}/files/${file.id}`;
    },
    // Both routes serve with Content-Disposition: attachment, so pointing an
    // iframe at one downloads the file instead of showing it. Fetching the
    // bytes and handing the viewer a blob: URL is what makes it render in
    // place - the same approach the contestant portal takes.
    previewMimeType: function (location) {
      const ext = (location.split(".").pop() || "").toLowerCase();
      const types = {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        json: "application/json",
        csv: "text/csv",
        xml: "application/xml",
      };
      return types[ext] || "text/plain";
    },
    isPreviewable: function (location) {
      return this.fileKind(location) !== null;
    },
    previewFile: function (file) {
      const name = file.location.split("/").pop();
      const kind = this.fileKind(file.location);
      const href = this.fileUrl(file);

      this.preview = { name: name, url: "", href: href, kind: kind, loading: true };

      fetch(href, { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error("Could not load file");
          return response.arrayBuffer();
        })
        .then((buffer) => {
          // Re-type the blob from the extension: the store may hand back
          // application/octet-stream, which the viewer refuses to render.
          const blob = new Blob([buffer], {
            type: this.previewMimeType(file.location),
          });
          if (!this.preview || this.preview.name !== name) return;
          this.preview = Object.assign({}, this.preview, {
            url: URL.createObjectURL(blob),
            loading: false,
          });
        })
        .catch(() => {
          if (!this.preview || this.preview.name !== name) return;
          this.preview = Object.assign({}, this.preview, {
            loading: false,
            error: true,
          });
        });
    },
    closePreview: function () {
      if (this.preview && this.preview.url) {
        URL.revokeObjectURL(this.preview.url);
      }
      this.preview = null;
    },
    loadFiles: function () {
      CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}/files`, {
        method: "GET",
      })
        .then((response) => {
          return response.json();
        })
        .then((response) => {
          if (response.success) {
            this.files = response.data;
          }
        });
    },
    addFiles: function () {
      // Validate file size before upload (max 5MB)
      const fileInput = this.$refs.FileUploadForm.querySelector('input[type="file"]');
      if (fileInput && fileInput.files.length > 0) {
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        for (let i = 0; i < fileInput.files.length; i++) {
          const file = fileInput.files[i];
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          
          if (file.size > maxSize) {
            alert(`File "${file.name}" (${fileSizeMB}MB) exceeds the 5MB limit. Please select smaller files.`);
            return; // Stop upload
          }
        }
      }

      this.isUploading = true;
      this.uploadError = false;
      this.uploadStatus = "Uploading files...";
      
      let data = {
        challenge_id: this.$props.challenge_id,
        type: "challenge",
      };
      let form = this.$refs.FileUploadForm;
      helpers.files
        .upload(form, data)
        .then(() => {
          this.uploadStatus = "Upload successful.";
          this.uploadError = false;
          this.isUploading = false;
          setTimeout(() => {
            this.loadFiles();
            this.uploadStatus = "";
          }, 700);
        })
        .catch((error) => {
          this.uploadStatus = error?.message || "Upload failed. Please try again.";
          this.uploadError = true;
          this.isUploading = false;
        });
    },
    deleteFile: function (fileId) {
      ezQuery({
        title: "Delete Files",
        body: "Are you sure you want to delete this file?",
        success: () => {
          CTFd.fetch(`/api/v1/files/${fileId}`, {
            method: "DELETE",
          })
            .then((response) => {
              return response.json();
            })
            .then((response) => {
              if (response.success) {
                this.loadFiles();
              }
            });
        },
      });
    },
  },
  created() {
    this.loadFiles();
  },
};
</script>

<style scoped>
/* Clean File List Styles */
#filesboard {
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

#filesboard thead {
  background: #f8f9fa;
}

#filesboard thead td {
  border-bottom: 2px solid #e8e8e8;
  color: #495057;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.5px;
  padding: 0.75rem;
}

#filesboard tbody tr {
  border-bottom: 1px solid #f1f1f1;
  transition: all 0.15s ease;
}

#filesboard tbody tr:hover {
  background: #fffbf9;
}

#filesboard tbody td {
  padding: 0.75rem;
  vertical-align: middle;
}

#filesboard tbody td a {
  color: #495057;
  text-decoration: none;
  transition: color 0.2s ease;
  font-weight: 500;
}

#filesboard tbody td a:hover {
  color: #ff6b35;
}

.delete-file {
  color: #6c757d;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1.1rem;
  padding: 0.25rem 0.5rem;
}

.delete-file:hover {
  color: #dc3545;
  transform: scale(1.1);
}

.preview-file {
  color: #6c757d;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1.1rem;
  padding: 0.25rem 0.5rem;
}

.preview-file:hover {
  color: #ff6b35;
  transform: scale(1.1);
}

.file-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.file-preview-box {
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 1000px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e8e8e8;
  background: #f8f9fa;
}

.file-preview-name {
  font-weight: 600;
  color: #2c3e50;
  font-size: 0.95rem;
  word-break: break-all;
}

.file-preview-action {
  color: #6c757d;
  cursor: pointer;
  margin-left: 0.85rem;
  font-size: 1rem;
  transition: color 0.2s ease;
}

.file-preview-action:hover {
  color: #ff6b35;
}

.file-preview-body {
  flex: 1;
  overflow: auto;
  background: #f1f1f1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-preview-body iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
}

.file-preview-body img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.file-preview-note {
  color: #6c757d;
  font-size: 0.95rem;
}

.form-control-file {
  border: 2px dashed #dee2e6;
  border-radius: 4px;
  padding: 1rem;
  background: #ffffff;
  transition: all 0.2s ease;
  display: block;
  width: 100%;
  cursor: pointer;
}

.form-control-file:hover {
  border-color: #ff6b35;
  background: #fff5f2;
}

.text-muted {
  color: #6c757d;
  font-size: 0.875rem;
  margin-top: 0.5rem;
  display: block;
}

.btn-primary {
  background: #ff6b35;
  color: #ffffff;
  border: 1px solid #ff6b35;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: #e85d2a;
  border-color: #e85d2a;
  color: #ffffff;
}
</style>
