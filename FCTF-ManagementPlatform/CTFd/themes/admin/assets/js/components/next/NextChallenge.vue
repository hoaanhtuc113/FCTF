<template>
  <div>
    <form @submit.prevent="updateNext">
      <div class="form-group">
        <label>
          Next Challenge
          <br />
          <small class="text-muted"
            >Challenge to recommend after solving this challenge</small
          >
        </label>
        <select class="form-control custom-select" v-model="selected_id">
          <option :value="null">--</option>
          <option
            v-for="challenge in otherChallenges"
            :value="challenge.id"
            :key="challenge.id"
          >
            {{ challenge.name }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <div class="form-group">
          <button
            class="btn btn-primary float-right"
            :disabled="!updateAvailable"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<script>
import CTFd from "../../compat/CTFd";

export default {
  props: {
    challenge_id: Number,
    // next_id is passed from the Jinja template (window.CHALLENGE_NEXT_ID)
    // so we never need to call GET /api/v1/challenges/{id} at all
    initial_next_id: { type: Number, default: null },
  },
  data: function () {
    return {
      challenges: [],
      // Track what is currently saved in the DB
      saved_next_id: this.initial_next_id,
      // Track what user has selected in the dropdown
      selected_id: this.initial_next_id,
    };
  },
  computed: {
    updateAvailable: function () {
      // Enable Save when user's selection differs from what's saved in DB
      return this.selected_id !== this.saved_next_id;
    },
    // All challenges in contest except the current one
    otherChallenges: function () {
      return this.challenges.filter((challenge) => {
        return challenge.id !== this.$props.challenge_id;
      });
    },
  },
  methods: {
    loadChallenges: function () {
      const contestId = window.CONTEST_ID;
      if (!contestId) {
        console.warn("[NextChallenge] window.CONTEST_ID not set, cannot load challenges.");
        return;
      }
      const url = `/api/v1/contest_challenges?contest_id=${contestId}&per_page=200`;
      CTFd.fetch(url, {
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
            this.challenges = response.data;
          } else {
            console.error("[NextChallenge] API error:", response);
          }
        })
        .catch((err) => {
          console.error("[NextChallenge] loadChallenges failed:", err, "URL:", url);
        });
    },
    updateNext: function () {
      const newNextId = this.selected_id !== null ? this.selected_id : null;
      CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          next_id: newNextId,
        }),
      })
        .then((response) => {
          return response.json();
        })
        .then((data) => {
          console.log("[NextChallenge] updateNext response:", data);
          if (data.success) {
            // Update local saved state — no re-fetch needed
            this.saved_next_id = newNextId;
            console.log("[NextChallenge] Saved next_id:", newNextId);
          } else {
            alert("Failed to save: " + JSON.stringify(data.errors || data));
          }
        })
        .catch((err) => {
          console.error("[NextChallenge] updateNext error:", err);
          alert("Network error while saving.");
        });
    },
  },
  created() {
    this.loadChallenges();
  },
};
</script>

<style scoped>
/* Clean Next Challenge Styles */
.form-group label {
  color: #495057;
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.form-group small {
  color: #6c757d;
  font-size: 0.875rem;
  display: block;
  margin-top: 0.25rem;
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

.btn-primary:disabled {
  background: #f8f9fa;
  color: #9ca3af;
  border-color: #e8e8e8;
  cursor: not-allowed;
  opacity: 0.6;
}
</style>

