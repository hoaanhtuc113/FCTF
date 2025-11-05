<template>
  <div class="col-md-12">
    <div id="challenge-tags" class="my-3">
      <span
        class="badge badge-primary mx-1 challenge-tag"
        v-for="tag in tags"
        :key="tag.id"
      >
        <span>{{ tag.value }}</span>
        <a class="btn-fa delete-tag" @click="deleteTag(tag.id)"> &#215;</a>
      </span>
    </div>

    <div class="form-group">
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
        @keyup.enter="addTag()"
      />
    </div>
  </div>
</template>

<script>
import CTFd from "../../compat/CTFd";

export default {
  props: {
    challenge_id: Number,
  },
  data: function () {
    return {
      tags: [],
      tagValue: "",
    };
  },
  methods: {
    loadTags: function () {
      CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}/tags`, {
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
            this.tags = response.data;
          }
        });
    },
    addTag: function () {
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
    },
    deleteTag: function (tag_id) {
      CTFd.api.delete_tag({ tagId: tag_id }).then((response) => {
        if (response.success) {
          this.loadTags();
        }
      });
    },
  },
  created() {
    this.loadTags();
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
