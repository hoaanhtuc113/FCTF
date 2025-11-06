<template>
  <div id="flag-create-modal" class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header text-center">
          <div class="container">
            <div class="row">
              <div class="col-md-12">
                <h3>Create Flag</h3>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="close"
            data-dismiss="modal"
            aria-label="Close"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="create-keys-select-div">
            <label for="create-keys-select" class="control-label">
              Choose Flag Type
            </label>
            <select
              class="form-control custom-select"
              @change="selectType($event)"
            >
              <option>--</option>
              <option
                v-for="type in Object.keys(types)"
                :value="type"
                :key="type"
              >
                {{ type }}
              </option>
            </select>
          </div>
          <br />
          <form @submit.prevent="submitFlag">
            <div id="create-flag-form" v-html="createForm"></div>
            <div class="form-group">
              <button
                class="btn btn-primary float-right"
                type="submit"
                v-if="createForm"
              >
                Create Flag
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import $ from "jquery";
import CTFd from "../../compat/CTFd";
import nunjucks from "nunjucks";
import "../../compat/json";

export default {
  name: "FlagCreationForm",
  props: {
    challenge_id: Number,
  },
  data: function () {
    return {
      types: {},
      selectedType: null,
      createForm: "",
    };
  },
  methods: {
    selectType: function (event) {
      let flagType = event.target.value;
      if (this.types[flagType] === undefined) {
        this.selectedType = null;
        this.createForm = "";
        return;
      }
      let createFormURL = this.types[flagType]["templates"]["create"];

      $.get(CTFd.config.urlRoot + createFormURL, (template_data) => {
        const template = nunjucks.compile(template_data);
        this.selectedType = flagType;
        this.createForm = template.render();

        // TODO: See https://github.com/CTFd/CTFd/issues/1779
        if (this.createForm.includes("<script")) {
          setTimeout(() => {
            $(`<div>` + this.createForm + `</div>`)
              .find("script")
              .each(function () {
                eval($(this).html());
              });
          }, 100);
        }
      });
    },
    loadTypes: function () {
      CTFd.fetch("/api/v1/flags/types", {
        method: "GET",
      })
        .then((response) => {
          return response.json();
        })
        .then((response) => {
          this.types = response.data;
        });
    },
    submitFlag: function (event) {
      let form = $(event.target);
      let params = form.serializeJSON(true);
      params["challenge"] = this.$props.challenge_id;

      CTFd.fetch("/api/v1/flags", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      })
        .then((response) => {
          return response.json();
        })
        .then((_response) => {
          this.$emit("refreshFlags", this.$options.name);
        });
    },
  },
  created() {
    this.loadTypes();
  },
};
</script>

<style scoped>
/* Clean Flag Creation Modal */
.modal-header {
  background: #ffffff;
  border-bottom: 1px solid #e8e8e8;
  padding: 1.25rem;
}

.modal-header h3 {
  color: #2c3e50;
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.modal-header .close {
  color: #6c757d;
  opacity: 1;
  transition: color 0.2s ease;
}

.modal-header .close:hover {
  color: #ff6b35;
}

.modal-body {
  padding: 1.5rem;
}

.control-label {
  color: #495057;
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
  display: block;
}

.form-control {
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.form-control:focus {
  border-color: #ff6b35;
  box-shadow: 0 0 0 0.15rem rgba(255, 107, 53, 0.15);
  outline: none;
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
}
</style>
