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
            <a :href="`${urlRoot}/files/${file.location}`">{{
              file.location.split("/").pop()
            }}</a>
          </td>

          <td class="text-center">
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
        <div class="form-group">
          <input
            class="btn btn-primary float-right"
            id="_submit"
            name="_submit"
            type="submit"
            value="Upload"
          />
        </div>
      </form>
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
    };
  },
  methods: {
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
      
      let data = {
        challenge: this.$props.challenge_id,
        type: "challenge",
      };
      let form = this.$refs.FileUploadForm;
      helpers.files.upload(form, data, (_response) => {
        setTimeout(() => {
          this.loadFiles();
        }, 700);
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
