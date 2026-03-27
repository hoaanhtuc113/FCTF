<template>
  <div class="modal fade" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header text-center">
          <div class="container">
            <div class="row">
              <div class="col-md-12">
                <h3>Hint</h3>
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
        <form method="POST" @submit.prevent="submitHint">
          <div class="modal-body">
            <div class="container">
              <div class="row">
                <div class="col-md-12">
                  <div class="form-group">
                    <label>
                      Hint<br />
                      <small>Markdown &amp; HTML are supported</small>
                    </label>
                    <textarea
                      type="text"
                      class="form-control markdown"
                      name="content"
                      rows="7"
                      ref="content"
                    ></textarea>
                  </div>

                  <div class="form-group">
                    <label>
                      Cost<br />
                      <small>How many points it costs to see your hint.</small>
                    </label>
                    <input
                      type="number"
                      class="form-control"
                      name="cost"
                      min="0"
                      v-model.lazy="cost"
                    />
                  </div>

                  <div class="form-group">
                    <label>
                      Requirements<br />
                      <small
                        >Hints that must be unlocked before unlocking this
                        hint</small
                      >
                    </label>
                    <div
                      class="form-check"
                      v-for="hint in hints"
                      :key="hint.id"
                    >
                      <label class="form-check-label cursor-pointer">
                        <input
                          class="form-check-input"
                          type="checkbox"
                          :value="hint.id"
                          v-model="selectedHints"
                        />
                        {{ formatHintLabel(hint) }}
                      </label>
                    </div>
                  </div>
                  <input type="hidden" id="hint-id-for-hint" name="id" />
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <div class="container">
              <div class="row">
                <div class="col-md-12">
                  <div class="form-group">
                    <button class="btn btn-primary float-right">Submit</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "HintCreationForm",
  props: {
    challenge_id: Number,
    hints: Array,
  },
  data: function () {
    return {
      cost: 0,
      selectedHints: [],
    };
  },
  methods: {
    formatHintLabel: function (hint) {
      const normalized = String(hint.content || "")
        .replaceAll(/\s+/g, " ")
        .trim();
      const preview = normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
      return `Hint #${hint.id} | ${preview || "(empty)"} | ${hint.cost} pts`;
    },
    getCost: function () {
      const cost = Number(this.cost);
      return Number.isFinite(cost) ? cost : 0;
    },
    getContent: function () {
      return this.$refs.content.value;
    },
    submitHint: function () {
      const cost = this.getCost();
      if (cost < 0) {
        alert("Cost must be a positive number");
        return;
      }
      let params = {
        challenge_id: this.$props.challenge_id,
        content: this.getContent(),
        cost,
        requirements: { prerequisites: this.selectedHints },
      };
      CTFd.fetch("/api/v1/hints", {
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
        .then((response) => {
          if (response.success) {
            this.$emit("refreshHints", this.$options.name);
          }
        });
    },
  },
};
</script>

<style scoped>
/* Clean Hint Creation Modal */
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

.form-group label {
  color: #495057;
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.form-group small {
  color: #6c757d;
  font-size: 0.875rem;
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

.form-check {
  margin-bottom: 0.75rem;
}

.form-check-label {
  color: #495057;
  font-size: 0.9rem;
  cursor: pointer;
  transition: color 0.2s ease;
}

.form-check-label:hover {
  color: #ff6b35;
}

.form-check-input {
  cursor: pointer;
}

.form-check-input:checked {
  background-color: #ff6b35;
  border-color: #ff6b35;
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

.modal-footer {
  border-top: 1px solid #e8e8e8;
  background: #f8f9fa;
  padding: 1rem 1.5rem;
}
</style>
