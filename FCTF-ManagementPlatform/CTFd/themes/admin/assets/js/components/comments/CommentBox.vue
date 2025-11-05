<template>
  <div class="clean-comment-box">
    <div class="row mb-3">
      <div class="col-md-12">
        <div class="comment">
          <textarea
            class="clean-textarea"
            rows="3"
            id="comment-input"
            placeholder="Add comment..."
            v-model.lazy="comment"
          ></textarea>
          <button
            class="clean-btn clean-btn-primary float-right mt-2"
            type="submit"
            @click="submitComment()"
          >
            <i class="fas fa-comment"></i> Comment
          </button>
        </div>
      </div>
    </div>

    <div class="row mb-3" v-if="pages > 1">
      <div class="col-md-12">
        <div class="text-center">
          <button
            type="button"
            class="clean-pagination-btn"
            @click="prevPage()"
            :disabled="prev ? false : true"
          >
            <i class="fas fa-chevron-left"></i> Previous
          </button>
          <span class="clean-page-info mx-3">
            Page {{ page }} of {{ pages }}
          </span>
          <button
            type="button"
            class="clean-pagination-btn"
            @click="nextPage()"
            :disabled="next ? false : true"
          >
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
      <div class="col-md-12 mt-2">
        <div class="text-center">
          <small class="clean-text-muted">{{ total }} total comments</small>
        </div>
      </div>
    </div>
    <div class="comments">
      <transition-group name="comment-card">
        <div
          class="clean-comment-card"
          v-for="comment in comments"
          :key="comment.id"
        >
          <button
            type="button"
            class="clean-close-btn"
            aria-label="Close"
            @click="deleteComment(comment.id)"
          >
            <i class="fas fa-times"></i>
          </button>
          <div class="clean-comment-content">
            <div class="clean-comment-text" v-html="comment.html"></div>
            <div class="clean-comment-meta">
              <small class="clean-comment-author">
                <a :href="`${urlRoot}/admin/users/${comment.author_id}`">
                  <i class="fas fa-user"></i> {{ comment.author.name }}
                </a>
              </small>
              <small class="clean-comment-date">
                <i class="far fa-clock"></i> {{ toLocalTime(comment.date) }}
              </small>
            </div>
          </div>
        </div>
      </transition-group>
    </div>
    <div class="row mt-3" v-if="pages > 1">
      <div class="col-md-12">
        <div class="text-center">
          <button
            type="button"
            class="clean-pagination-btn"
            @click="prevPage()"
            :disabled="prev ? false : true"
          >
            <i class="fas fa-chevron-left"></i> Previous
          </button>
          <span class="clean-page-info mx-3">
            Page {{ page }} of {{ pages }}
          </span>
          <button
            type="button"
            class="clean-pagination-btn"
            @click="nextPage()"
            :disabled="next ? false : true"
          >
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
      <div class="col-md-12 mt-2">
        <div class="text-center">
          <small class="clean-text-muted">{{ total }} total comments</small>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import CTFd from "../../compat/CTFd";
import { default as helpers } from "../../compat/helpers";
import dayjs from "dayjs";
import hljs from "highlight.js";
export default {
  props: {
    // These props are passed to the api via query string.
    // See this.getArgs()
    type: String,
    id: Number,
  },
  data: function () {
    return {
      page: 1,
      pages: null,
      next: null,
      prev: null,
      total: null,
      comment: "",
      comments: [],
      urlRoot: CTFd.config.urlRoot,
    };
  },
  methods: {
    toLocalTime(date) {
      return dayjs(date).format("MMMM Do, h:mm:ss A");
    },
    nextPage: function () {
      this.page++;
      this.loadComments();
    },
    prevPage: function () {
      this.page--;
      this.loadComments();
    },
    getArgs: function () {
      let args = {};
      args[`${this.$props.type}_id`] = this.$props.id;
      return args;
    },
    loadComments: function () {
      let apiArgs = this.getArgs();
      apiArgs[`page`] = this.page;
      apiArgs[`per_page`] = 10;

      helpers.comments.get_comments(apiArgs).then((response) => {
        this.page = response.meta.pagination.page;
        this.pages = response.meta.pagination.pages;
        this.next = response.meta.pagination.next;
        this.prev = response.meta.pagination.prev;
        this.total = response.meta.pagination.total;
        this.comments = response.data;
        return this.comments;
      });
    },
    submitComment: function () {
      let comment = this.comment.trim();
      if (comment.length > 0) {
        helpers.comments.add_comment(
          comment,
          this.$props.type,
          this.getArgs(),
          () => {
            this.loadComments();
          }
        );
      }
      this.comment = "";
    },
    deleteComment: function (commentId) {
      if (confirm("Are you sure you'd like to delete this comment?")) {
        helpers.comments.delete_comment(commentId).then((response) => {
          if (response.success === true) {
            for (let i = this.comments.length - 1; i >= 0; --i) {
              if (this.comments[i].id == commentId) {
                this.comments.splice(i, 1);
              }
            }
          }
        });
      }
    },
  },
  created() {
    this.loadComments();
  },
  updated() {
    this.$el.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightBlock(block);
    });
  },
};
</script>

<style scoped>
/* Clean Comment Box Styles */
.clean-comment-box {
  padding: 0.5rem 0;
}

.clean-textarea {
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 0.75rem;
  font-size: 0.9rem;
  width: 100%;
  transition: all 0.2s ease;
  font-family: inherit;
  resize: vertical;
}

.clean-textarea:focus {
  border-color: #ff6b35;
  box-shadow: 0 0 0 0.15rem rgba(255, 107, 53, 0.15);
  outline: none;
}

.clean-textarea::placeholder {
  color: #9ca3af;
}

.clean-btn {
  border: 1px solid #dee2e6;
  background: #ffffff;
  color: #495057;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
}

.clean-btn:hover {
  border-color: #ff6b35;
  color: #ff6b35;
  background: #fff5f2;
}

.clean-btn-primary {
  background: #ff6b35;
  color: #ffffff;
  border-color: #ff6b35;
}

.clean-btn-primary:hover {
  background: #e85d2a;
  border-color: #e85d2a;
  color: #ffffff;
}

.clean-pagination-btn {
  border: 1px solid #dee2e6;
  background: #ffffff;
  color: #495057;
  padding: 0.375rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
}

.clean-pagination-btn:hover:not(:disabled) {
  border-color: #ff6b35;
  color: #ff6b35;
  background: #fff5f2;
}

.clean-pagination-btn:disabled {
  background: #f8f9fa;
  color: #9ca3af;
  border-color: #e8e8e8;
  cursor: not-allowed;
  opacity: 0.6;
}

.clean-page-info {
  color: #495057;
  font-weight: 500;
  font-size: 0.9rem;
}

.clean-text-muted {
  color: #6c757d;
}

.clean-comment-card {
  background: #ffffff;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
  position: relative;
  transition: all 0.2s ease;
}

.clean-comment-card:hover {
  border-color: #ff6b35;
  box-shadow: 0 2px 8px rgba(255, 107, 53, 0.1);
}

.clean-close-btn {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: transparent;
  border: none;
  color: #9ca3af;
  font-size: 1.25rem;
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.clean-comment-card:hover .clean-close-btn {
  opacity: 1;
}

.clean-close-btn:hover {
  color: #dc3545;
  background: #fff5f5;
}

.clean-comment-content {
  padding-right: 2rem;
}

.clean-comment-text {
  color: #2c3e50;
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 0.75rem;
}

.clean-comment-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.75rem;
  border-top: 1px solid #f1f1f1;
}

.clean-comment-author a {
  color: #495057;
  text-decoration: none;
  transition: color 0.2s ease;
}

.clean-comment-author a:hover {
  color: #ff6b35;
}

.clean-comment-author i {
  margin-right: 0.25rem;
  color: #9ca3af;
}

.clean-comment-date {
  color: #6c757d;
}

.clean-comment-date i {
  margin-right: 0.25rem;
}

/* Transition animations */
.comment-card-leave {
  max-height: 200px;
  opacity: 1;
}

.comment-card-leave-to {
  max-height: 0;
  opacity: 0;
  margin-bottom: 0;
  padding: 0;
  border-width: 0;
}

.comment-card-active {
  position: absolute;
  width: 100%;
}

.comment-card-enter {
  opacity: 0;
  transform: translateY(-10px);
}

.comment-card-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.comment-card-enter-active,
.comment-card-move,
.comment-card-leave-active {
  transition: all 0.3s ease;
}
</style>
