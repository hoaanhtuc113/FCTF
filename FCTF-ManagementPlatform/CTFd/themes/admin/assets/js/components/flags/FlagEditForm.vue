<template>
  <div id="flag-edit-modal" class="modal fade" tabindex="-1">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header text-center">
          <div class="container">
            <div class="row">
              <div class="col-md-12">
                <h3 class="text-center">Edit Flag</h3>
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
          <div class="edit-keys-select-div">
            <label for="edit-keys-select" class="control-label">
              Flag Type
            </label>
            <select
              id="edit-keys-select"
              class="form-control custom-select"
              :value="selectedType"
              @change="selectType($event)"
            >
              <option
                v-for="type in Object.keys(types)"
                :value="type"
                :key="type"
              >
                {{ type }}
              </option>
            </select>
            <small class="form-text text-muted" v-if="typeChanged">
              Changing the type replaces how this flag is checked. A dynamic
              flag is generated per team; a static or regex flag uses the value
              you enter below.
            </small>
          </div>
          <br />
          <form
            method="POST"
            v-html="editForm"
            @submit.prevent="updateFlag"
          ></form>
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
  name: "FlagEditForm",
  props: {
    flag_id: Number,
  },
  data: function () {
    return {
      flag: {},
      editForm: "",
      types: {},
      selectedType: null,
    };
  },
  computed: {
    typeChanged: function () {
      return (
        this.selectedType !== null &&
        this.flag.type !== undefined &&
        this.selectedType !== this.flag.type
      );
    },
  },
  watch: {
    flag_id: {
      immediate: true,
      handler(val, oldVal) {
        if (val !== null) {
          this.loadFlag();
        }
      },
    },
  },
  methods: {
    loadTypes: function () {
      if (Object.keys(this.types).length) {
        return Promise.resolve(this.types);
      }
      return CTFd.fetch("/api/v1/flags/types", {
        method: "GET",
      })
        .then((response) => {
          return response.json();
        })
        .then((response) => {
          this.types = response.data;
          return this.types;
        });
    },
    loadFlag: function () {
      this.loadTypes().then(() => {
        CTFd.fetch(`/api/v1/flags/${this.$props.flag_id}`, {
          method: "GET",
        })
          .then((response) => {
            return response.json();
          })
          .then((response) => {
            this.flag = response.data;
            this.selectedType = this.flag.type;
            this.renderForm(this.flag.type);
          });
      });
    },
    selectType: function (event) {
      this.selectedType = event.target.value;
      this.renderForm(this.selectedType);
    },
    // The form for the selected type, not necessarily the type the flag has
    // now: an admin who created a challenge with the wrong kind of flag can
    // switch it here instead of deleting the flag and adding another one.
    renderForm: function (flagType) {
      const type = this.types[flagType];
      // Fall back to the template the flag itself reported, so the form still
      // renders if the type list could not be fetched.
      const editFormURL = type
        ? type["templates"]["update"]
        : this.flag["templates"]["update"];

      // Content and case sensitivity belong to the type that stored them, so
      // they are only prefilled while the type is unchanged. Carrying a static
      // flag's value into the regex form would offer it as a pattern it was
      // never written to be.
      const context =
        flagType === this.flag.type ? this.flag : { id: this.flag.id };

      $.get(CTFd.config.urlRoot + editFormURL, (template_data) => {
        const template = nunjucks.compile(template_data);
        this.editForm = template.render(context);

        // TODO: See https://github.com/CTFd/CTFd/issues/1779
        if (this.editForm.includes("<script")) {
          setTimeout(() => {
            $(`<div>` + this.editForm + `</div>`)
              .find("script")
              .each(function () {
                eval($(this).html());
              });
          }, 100);
        }
      });
    },
    updateFlag: function (event) {
      let form = $(event.target);
      let params = form.serializeJSON(true);

      CTFd.fetch(`/api/v1/flags/${this.$props.flag_id}`, {
        method: "PATCH",
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
        .then((response) => {
          this.$emit("refreshFlags", this.$options.name);
        });
    },
  },
  mounted() {
    if (this.flag_id) {
      this.loadFlag();
    }
  },
  created() {
    if (this.flag_id) {
      this.loadFlag();
    }
  },
};
</script>

<style scoped>
/* Clean Flag Edit Modal */
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
</style>
