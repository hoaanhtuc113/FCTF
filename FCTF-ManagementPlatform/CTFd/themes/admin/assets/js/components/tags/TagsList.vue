<template>
  <div class="col-md-12">
    <div id="challenge-tags" class="my-3">
      <!-- Render selected tags in picker mode, otherwise show challenge tags -->
      <span
        class="badge badge-primary mx-1 challenge-tag"
        v-for="tag in (picker ? selectedTags : tags)"
        :key="tag.id || tag.value"
      >
        <span>{{ tag.value }}</span>
        <a class="btn-fa delete-tag" @click="deleteTag(tag.id || tag.value)"> &#215;</a>
      </span>
    </div>

    <div class="form-group position-relative">
      <label
        >Tag
        <br />
        <small class="text-muted">Type tag and press Enter</small>
      </label>
      <input
        id="tags-add-input"
        maxlength="80"
        type="text"
        class="form-control"
        v-model="tagValue"
        @keyup.enter.prevent="addTag"
      />
    </div>
  </div>
</template>

<script>
import CTFd from "../../compat/CTFd";

export default {
  props: {
    challenge_id: Number,
    // When true this component acts as a tag picker for search (global tags)
    picker: { type: Boolean, default: false },
    // Initial tags CSV for picker mode
    initial_tags: { type: String, default: "" },
  },
  data: function () {
    return {
      // For challenge mode: list of tag objects for this challenge
      tags: [],
      tagValue: "",
      // Picker mode state
      suggestions: [],
      selectedTags: [],
      loading: false,
    };
  },
  methods: {
    loadTags: function () {
      if (this.picker) {
        // Load all tags for suggestions
        CTFd.fetch(`/api/v1/tags?field=value`, {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        })
          .then((response) => response.json())
          .then((response) => {
            if (response.success) {
              this.suggestions = response.data;
              // Attempt to resolve any initial selected tags to full objects
              if (this.selectedTags && this.selectedTags.length) {
                this.selectedTags = this.selectedTags.map((t) => {
                  const match = this.suggestions.find((s) => s.value === t.value);
                  return match ? match : t;
                });
                this.updateHiddenInput();
              }
            }
          })
          .catch((err) => console.error("Failed to load tag suggestions", err));
      } else {
        // Existing behavior: load tags for a specific challenge
        CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}/tags`, {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        })
          .then((response) => response.json())
          .then((response) => {
            if (response.success) {
              this.tags = response.data;
            }
          })
          .catch((err) => console.error("Failed to load challenge tags", err));
      }
    },
    addTag: function () {
      if (this.picker) {
        // In picker mode, add tag to selection (if exists or create on server)
        const value = this.tagValue && this.tagValue.trim();
        if (!value) return;
        // Try to find existing suggestion
        const existing = this.suggestions.find((t) => t.value === value);
        if (existing) {
          this.toggleSelect(existing);
          this.tagValue = "";
          return;
        }
        // Create new tag via API
        const params = { value: value };
        CTFd.fetch(`/api/v1/tags`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        })
          .then((r) => r.json())
          .then((response) => {
            if (response.success) {
              this.suggestions.push(response.data);
              this.toggleSelect(response.data);
              this.tagValue = "";
            }
          })
          .catch((err) => console.error("Failed to create tag", err));
      } else {
        // Existing behavior: add tag to challenge
        if (this.tagValue) {
          const params = {
            value: this.tagValue,
            challenge: this.$props.challenge_id,
          };
          CTFd.api.post_tag_list({}, params).then((response) => {
            if (response.success) {
              this.tagValue = "";
              this.loadTags();
            }
          });
        }
      }
    },
    deleteTag: function (tag_id) {
      if (this.picker) {
        // In picker mode remove from selectedTags
        const idx = this.selectedTags.findIndex((t) => t.id === tag_id || t.value === tag_id);
        if (idx !== -1) {
          this.selectedTags.splice(idx, 1);
          this.updateHiddenInput();
        }
      } else {
        CTFd.api.delete_tag({ tagId: tag_id }).then((response) => {
          if (response.success) {
            this.loadTags();
          }
        });
      }
    },
    toggleSelect: function (tag) {
      const exists = this.selectedTags.find((t) => t.id === tag.id || t.value === tag.value);
      if (exists) {
        this.selectedTags = this.selectedTags.filter((t) => t.id !== tag.id && t.value !== tag.value);
      } else {
        this.selectedTags.push(tag);
      }
      this.updateHiddenInput();
    },
    updateHiddenInput: function () {
      const values = this.selectedTags.map((t) => t.value);
      const hidden = document.getElementById("tags-hidden");
      if (hidden) hidden.value = values.join(",");
    },

  },
  created() {
    this.loadTags();
    if (this.picker && this.initial_tags) {
      const initial = this.initial_tags.split(",").map((s) => s.trim()).filter((s) => s);
      // Set selected tags as simple objects - attempt to resolve ids from suggestions later
      this.selectedTags = initial.map((v) => ({ id: null, value: v }));
      // Ensure hidden input is populated
      this.updateHiddenInput();
    }
  },
};
</script>

<style scoped>
/* Clean Tags Styles */
#challenge-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 2rem;
}

.challenge-tag {
  background: #fff5f2;
  color: #495057;
  border: 1px solid #ffd4c4;
  padding: 0.375rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.challenge-tag:hover {
  background: #ffe8dd;
  border-color: #ff6b35;
}

.delete-tag {
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1.25rem;
  line-height: 1;
  text-decoration: none;
  padding: 0 0.25rem;
}

.delete-tag:hover {
  color: #dc3545;
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
  width: 100%;
}

.form-control:focus {
  border-color: #ff6b35;
  box-shadow: 0 0 0 0.15rem rgba(255, 107, 53, 0.15);
  outline: none;
}

</style>
