<template>
  <div>
    <div>
      <HintCreationForm
        ref="HintCreationForm"
        :challenge_id="challenge_id"
        :hints="hints"
        @refreshHints="refreshHints"
      />
    </div>

    <div>
      <HintEditForm
        ref="HintEditForm"
        :challenge_id="challenge_id"
        :hint_id="editing_hint_id"
        :hints="hints"
        @refreshHints="refreshHints"
      />
    </div>

    <table class="table table-striped">
      <thead>
        <tr>
          <td class="text-center"><b>ID</b></td>
          <td class="text-center"><b>Hint</b></td>
          <td class="text-center"><b>Cost</b></td>
          <td class="text-center"><b>Settings</b></td>
        </tr>
      </thead>
      <tbody>
        <tr v-for="hint in hints" :key="hint.id">
          <td class="text-center">{{ hint.type }}</td>
          <td class="text-break">
            <pre>{{ hint.content }}</pre>
          </td>
          <td class="text-center">{{ hint.cost }}</td>
          <td class="text-center">
            <i
              role="button"
              class="btn-fa fas fa-edit"
              @click="editHint(hint.id)"
            ></i>
            <i
              role="button"
              class="btn-fa fas fa-times"
              @click="deleteHint(hint.id)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="col-md-12">
      <div class="form-group">
        <button class="btn btn-primary float-right" @click="addHint">
          Create Hint
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ezQuery } from "../../compat/ezq";
import CTFd from "../../compat/CTFd";
import HintCreationForm from "./HintCreationForm.vue";
import HintEditForm from "./HintEditForm.vue";

export default {
  components: {
    HintCreationForm,
    HintEditForm,
  },
  props: {
    challenge_id: Number,
  },
  data: function () {
    return {
      hints: [],
      editing_hint_id: null,
    };
  },
  methods: {
    loadHints: async function () {
      let result = await CTFd.fetch(
        `/api/v1/challenges/${this.$props.challenge_id}/hints`,
        {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      let response = await result.json();
      this.hints = response.data;
      return response.success;
    },
    addHint: function () {
      let modal = this.$refs.HintCreationForm.$el;
      $(modal).modal();
    },
    editHint: function (hintId) {
      this.editing_hint_id = hintId;
      let modal = this.$refs.HintEditForm.$el;
      $(modal).modal();
    },
    refreshHints: function (caller) {
      this.loadHints().then((success) => {
        if (success) {
          let modal;
          switch (caller) {
            case "HintCreationForm":
              modal = this.$refs.HintCreationForm.$el;
              console.log(modal);
              $(modal).modal("hide");
              break;
            case "HintEditForm":
              modal = this.$refs.HintEditForm.$el;
              $(modal).modal("hide");
              break;
            default:
              break;
          }
        } else {
          alert(
            "An error occurred while updating this hint. Please try again."
          );
        }
      });
    },
    deleteHint: function (hintId) {
      ezQuery({
        title: "Delete Hint",
        body: "Are you sure you want to delete this hint?",
        success: () => {
          CTFd.fetch(`/api/v1/hints/${hintId}`, {
            method: "DELETE",
          })
            .then((response) => {
              return response.json();
            })
            .then((data) => {
              if (data.success) {
                this.loadHints();
              }
            });
        },
      });
    },
  },
  created() {
    this.loadHints();
  },
};
</script>

<style scoped>
/* Clean Hints List Styles */
.table {
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.table thead {
  background: #f8f9fa;
}

.table thead td {
  border-bottom: 2px solid #e8e8e8;
  color: #495057;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.5px;
  padding: 0.75rem;
}

.table tbody tr {
  border-bottom: 1px solid #f1f1f1;
  transition: all 0.15s ease;
}

.table tbody tr:hover {
  background: #fffbf9;
}

.table tbody td {
  padding: 0.75rem;
  vertical-align: middle;
}

.table tbody td pre {
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

.btn-fa:hover {
  color: #ff6b35;
  transform: scale(1.1);
}

.btn-fa.fa-times:hover {
  color: #dc3545;
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
