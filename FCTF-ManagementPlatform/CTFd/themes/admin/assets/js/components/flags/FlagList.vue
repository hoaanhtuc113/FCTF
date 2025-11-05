<template>
  <div>
    <div>
      <FlagCreationForm
        ref="FlagCreationForm"
        :challenge_id="challenge_id"
        @refreshFlags="refreshFlags"
      />
    </div>

    <div>
      <FlagEditForm
        ref="FlagEditForm"
        :flag_id="editing_flag_id"
        @refreshFlags="refreshFlags"
      />
    </div>

    <table id="flagsboard" class="table table-striped">
      <thead>
        <tr>
          <td class="text-center"><b>Type</b></td>
          <td class="text-center"><b>Flag</b></td>
          <td class="text-center"><b>Settings</b></td>
        </tr>
      </thead>
      <tbody>
        <tr :name="flag.id" v-for="flag in flags" :key="flag.id">
          <td class="text-center">{{ flag.type }}</td>
          <td class="text-break">
            <pre class="flag-content">{{ flag.content }}</pre>
          </td>
          <td class="text-center">
            <i
              role="button"
              class="btn-fa fas fa-edit edit-flag"
              :flag-id="flag.id"
              :flag-type="flag.type"
              @click="editFlag(flag.id)"
            ></i>
            <i
              role="button"
              class="btn-fa fas fa-times delete-flag"
              :flag-id="flag.id"
              @click="deleteFlag(flag.id)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="col-md-12">
      <div class="form-group">
        <button
          id="flag-add-button"
          class="btn btn-primary d-inline-block float-right"
          @click="addFlag()"
        >
          Create Flag
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import $ from "jquery";
import CTFd from "../../compat/CTFd";
import FlagCreationForm from "./FlagCreationForm.vue";
import FlagEditForm from "./FlagEditForm.vue";

export default {
  components: {
    FlagCreationForm,
    FlagEditForm,
  },
  props: {
    challenge_id: Number,
  },
  data: function () {
    return {
      flags: [],
      editing_flag_id: null,
    };
  },
  methods: {
    loadFlags: function () {
      CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}/flags`, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      })
        .then((response) => {
          return response.json();
        })
        .then((response) => {
          if (response.success) {
            this.flags = response.data;
          }
        });
    },
    refreshFlags(caller) {
      this.loadFlags();
      let modal;
      switch (caller) {
        case "FlagEditForm":
          modal = this.$refs.FlagEditForm.$el;
          $(modal).modal("hide");
          break;
        case "FlagCreationForm":
          modal = this.$refs.FlagCreationForm.$el;
          $(modal).modal("hide");
          break;
        default:
          break;
      }
    },
    addFlag: function () {
      let modal = this.$refs.FlagCreationForm.$el;
      $(modal).modal();
    },
    editFlag: function (flag_id) {
      this.editing_flag_id = flag_id;
      let modal = this.$refs.FlagEditForm.$el;
      $(modal).modal();
    },
    deleteFlag: function (flag_id) {
      if (confirm("Are you sure you'd like to delete this flag?")) {
        CTFd.fetch(`/api/v1/flags/${flag_id}`, {
          method: "DELETE",
        })
          .then((response) => {
            return response.json();
          })
          .then((response) => {
            if (response.success) {
              this.loadFlags();
            }
          });
      }
    },
  },
  created() {
    this.loadFlags();
  },
};
</script>

<style scoped>
/* Clean Flag List Styles */
#flagsboard {
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

#flagsboard thead {
  background: #f8f9fa;
}

#flagsboard thead td {
  border-bottom: 2px solid #e8e8e8;
  color: #495057;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.5px;
  padding: 0.75rem;
}

#flagsboard tbody tr {
  border-bottom: 1px solid #f1f1f1;
  transition: all 0.15s ease;
}

#flagsboard tbody tr:hover {
  background: #fffbf9;
}

#flagsboard tbody td {
  padding: 0.75rem;
  vertical-align: middle;
}

.flag-content {
  color: #2c3e50;
  font-size: 0.875rem;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Courier New', monospace;
  background: #f8f9fa;
  padding: 0.5rem;
  border-radius: 4px;
}

.btn-fa {
  color: #6c757d;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1.1rem;
  padding: 0.25rem 0.5rem;
  margin: 0 0.25rem;
}

.edit-flag:hover {
  color: #ff6b35;
  transform: scale(1.1);
}

.delete-flag:hover {
  color: #dc3545;
  transform: scale(1.1);
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
