<template>
  <div class="col-md-12">
    <div style="display: flex; flex-wrap: wrap; gap: 0.625rem; min-height: 2rem; align-items: center;" class="my-3">
      <span
        style="display: inline-flex; align-items: center; gap: 0.5rem; background: #f8f9fa; border: 1px solid #000000; padding: 0.375rem 0.625rem; border-radius: 0.25rem; font-size: 0.875rem; color: #495057; transition: all 0.15s ease; margin-right: 0.25rem;"
        v-for="tag in (picker ? selectedTags : tags)"
        :key="tag.id || tag.value"
      >
        {{ tag.value }}
        <a style="color: #6c757d; cursor: pointer; font-size: 1.125rem; line-height: 1; text-decoration: none; transition: color 0.15s ease; padding: 0 0.125rem; margin-left: 0.125rem;" @click="deleteTag(tag.id || tag.value)">×</a>
      </span>
      <span v-if="(picker ? selectedTags : tags).length === 0" class="text-muted small">
        {{ picker ? 'No tags selected' : 'No tags' }}
      </span>
    </div>

    <div class="form-group position-relative">
      <label style="font-weight: 500; font-size: 0.875rem; color: #495057; margin-bottom: 0.5rem;">
        Tags
        <small style="font-weight: 400; font-size: 0.75rem;" class="text-muted ml-2">
          {{ picker ? 'Search or create tags' : 'Press Enter to add' }}
        </small>
      </label>
      <input
        id="tags-add-input"
        maxlength="80"
        type="text"
        class="form-control"
        style="font-size: 0.875rem;"
        v-model="tagValue"
        @keydown="handleKeyNavigation"
        @keyup.enter.prevent="addTag"
        @input="onInputChange"
        @focus="onFocus"
        @blur="onBlur"
        :placeholder="picker ? 'Type to search...' : 'Tag name'"
        autocomplete="off"
      />
      
      <!-- Autocomplete suggestions dropdown -->
      <div 
        v-if="picker && showSuggestions && (filteredSuggestions.length > 0 || tagValue.trim())"
        style="position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1px solid #ced4da; border-top: none; border-radius: 0 0 0.25rem 0.25rem; box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075); max-height: 200px; overflow-y: auto; z-index: 1000; margin-top: -1px;"
      >
        <div
          v-for="(suggestion, index) in filteredSuggestions"
          :key="suggestion.id"
          :style="index === highlightedIndex ? 'padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; color: #212529; border-bottom: 1px solid #f8f9fa; transition: background-color 0.15s ease; background: #f8f9fa;' : 'padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; color: #495057; border-bottom: 1px solid #f8f9fa; transition: background-color 0.15s ease;'"
          @mousedown.prevent="selectSuggestion(suggestion)"
          @mouseenter="highlightedIndex = index"
        >
          {{ suggestion.value }}
        </div>
        <div
          v-if="tagValue.trim() && !filteredSuggestions.find(s => s.value.toLowerCase() === tagValue.trim().toLowerCase())"
          :style="highlightedIndex === filteredSuggestions.length ? 'padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; color: #007bff; font-weight: 500; border-top: 1px solid #dee2e6; transition: background-color 0.15s ease; background: #e7f1ff;' : 'padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; color: #007bff; font-weight: 500; border-top: 1px solid #dee2e6; transition: background-color 0.15s ease;'"
          @mousedown.prevent="addTag"
          @mouseenter="highlightedIndex = filteredSuggestions.length"
        >
          + Create "{{ tagValue.trim() }}"
        </div>
      </div>
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
      // Autocomplete state
      showSuggestions: false,
      highlightedIndex: -1,
    };
  },
  computed: {
    filteredSuggestions() {
      if (!this.picker || !this.tagValue) return [];
      const search = this.tagValue.toLowerCase().trim();
      // Filter out already selected tags and match search term
      return this.suggestions
        .filter(s => !this.selectedTags.find(t => t.id === s.id || t.value === s.value))
        .filter(s => s.value.toLowerCase().includes(search))
        .slice(0, 10); // Limit to 10 suggestions
    }
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
        
        // Hide suggestions
        this.showSuggestions = false;
        
        // Try to find existing suggestion
        const existing = this.suggestions.find((t) => t.value.toLowerCase() === value.toLowerCase());
        if (existing) {
          this.toggleSelect(existing);
          this.tagValue = "";
          this.highlightedIndex = -1;
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
              this.highlightedIndex = -1;
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
    onInputChange: function () {
      if (this.picker) {
        this.showSuggestions = this.tagValue.trim().length > 0;
        this.highlightedIndex = -1;
      }
    },
    onFocus: function () {
      if (this.picker && this.tagValue.trim()) {
        this.showSuggestions = true;
      }
    },
    onBlur: function () {
      setTimeout(() => {
        this.showSuggestions = false;
        this.highlightedIndex = -1;
      }, 200);
    },
    selectSuggestion: function (suggestion) {
      this.toggleSelect(suggestion);
      this.tagValue = "";
      this.showSuggestions = false;
      this.highlightedIndex = -1;
      // Refocus input for easy consecutive selections
      this.$nextTick(() => {
        document.getElementById("tags-add-input")?.focus();
      });
    },
    handleKeyNavigation: function (e) {
      if (!this.picker || !this.showSuggestions) return;
      
      const maxIndex = this.filteredSuggestions.length + (this.tagValue.trim() ? 0 : -1);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlightedIndex = Math.min(this.highlightedIndex + 1, maxIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
      } else if (e.key === 'Enter' && this.highlightedIndex >= 0) {
        e.preventDefault();
        if (this.highlightedIndex < this.filteredSuggestions.length) {
          this.selectSuggestion(this.filteredSuggestions[this.highlightedIndex]);
        } else {
          this.addTag();
        }
      }
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
