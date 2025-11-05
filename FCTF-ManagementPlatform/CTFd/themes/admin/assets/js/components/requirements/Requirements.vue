<template>
  <div>
    <form @submit.prevent="updateRequirements">
      <div class="form-group scrollbox">
        <transition-group name="flip-list">
          <div
            class="form-check"
            v-for="challenge in requiredChallenges"
            :key="challenge.id"
          >
            <label class="form-check-label cursor-pointer">
              <input
                class="form-check-input"
                type="checkbox"
                :value="challenge.id"
                v-model="selectedRequirements"
              />
              {{ challenge.name }}
            </label>
          </div>
          <div
            class="form-check"
            v-for="challenge in otherChallenges"
            :key="challenge.id"
          >
            <label class="form-check-label cursor-pointer">
              <input
                class="form-check-input"
                type="checkbox"
                :value="challenge.id"
                v-model="selectedRequirements"
              />
              {{ challenge.name }}
            </label>
          </div>
        </transition-group>
      </div>

      <div class="form-group">
        <label>
          <b>Behavior if not unlocked</b>
        </label>
        <select
          class="form-control custom-select"
          name="anonymize"
          v-model="selectedAnonymize"
        >
          <option :value="false">Hidden</option>
          <option :value="true">Anonymized</option>
        </select>
      </div>

      <div class="form-group">
        <button
          class="btn btn-primary float-right"
          :disabled="!newRequirements"
        >
          Save
        </button>
      </div>
    </form>
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
      challenges: [],
      requirements: {},
      selectedRequirements: [],
      selectedAnonymize: false,
    };
  },
  computed: {
    newRequirements: function () {
      let currentRequirements = this.requirements.prerequisites || [];
      let currentAnonymize = this.requirements.anonymize || false;
      let newReqs =
        JSON.stringify(currentRequirements.sort()) !==
        JSON.stringify(this.selectedRequirements.sort());
      let changedAnon = currentAnonymize !== this.selectedAnonymize;
      return newReqs || changedAnon;
    },
    // Get all currently required challenges
    requiredChallenges: function () {
      const prerequisites = this.requirements.prerequisites || [];
      return this.challenges.filter((challenge) => {
        return (
          challenge.id !== this.$props.challenge_id &&
          prerequisites.includes(challenge.id)
        );
      });
    },
    // Get all challenges besides the current one and current prereqs
    otherChallenges: function () {
      const prerequisites = this.requirements.prerequisites || [];
      return this.challenges.filter((challenge) => {
        return (
          challenge.id !== this.$props.challenge_id &&
          !prerequisites.includes(challenge.id)
        );
      });
    },
  },
  methods: {
    loadChallenges: function () {
      CTFd.fetch("/api/v1/challenges?view=admin", {
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
          }
        });
    },
    getChallengeNameById: function (challenge_id) {
      let challenge = this.challenges.find(
        (challenge) => challenge.id === challenge_id
      );
      return challenge ? challenge.name : "";
    },
    loadRequirements: function () {
      CTFd.fetch(
        `/api/v1/challenges/${this.$props.challenge_id}/requirements`,
        {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      )
        .then((response) => {
          return response.json();
        })
        .then((response) => {
          if (response.success) {
            this.requirements = response.data || {};
            this.selectedRequirements = this.requirements.prerequisites || [];
            this.selectedAnonymize = this.requirements.anonymize || false;
          }
        });
    },
    updateRequirements: function () {
      let selectedRequirements = this.selectedRequirements;

      const params = {
        requirements: {
          prerequisites: selectedRequirements,
        },
      };

      if (this.selectedAnonymize) {
        params.requirements.anonymize = true;
      }

      CTFd.fetch(`/api/v1/challenges/${this.$props.challenge_id}`, {
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
        .then((data) => {
          if (data.success) {
            this.loadRequirements();
          }
        });
    },
  },
  created() {
    this.loadChallenges();
    this.loadRequirements();
  },
};
</script>

<style scoped>
/* Clean Requirements Styles */
.flip-list-move {
  transition: transform 0.5s ease;
}

.scrollbox {
	overflow: auto;
	max-height: 40vh;
	border: 1px solid #e8e8e8;
	border-radius: 4px;
	padding: 1rem;
	background: #ffffff;

	background:
		/* Shadow covers */
		linear-gradient(white 30%, rgba(255,255,255,0)),
		linear-gradient(rgba(255,255,255,0), white 70%) 0 100%,

		/* Shadows */
		radial-gradient(50% 0, farthest-side, rgba(0,0,0,.2), rgba(0,0,0,0)),
		radial-gradient(50% 100%,farthest-side, rgba(0,0,0,.2), rgba(0,0,0,0)) 0 100%;
	background:
		/* Shadow covers */
		linear-gradient(white 30%, rgba(255,255,255,0)),
		linear-gradient(rgba(255,255,255,0), white 70%) 0 100%,

		/* Shadows */
		radial-gradient(farthest-side at 50% 0, rgba(0,0,0,.2), rgba(0,0,0,0)),
		radial-gradient(farthest-side at 50% 100%, rgba(0,0,0,.2), rgba(0,0,0,0)) 0 100%;
	background-repeat: no-repeat;
	background-color: white;
	background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
	background-attachment: local, local, scroll, scroll;
}

.form-check {
	margin-bottom: 0.75rem;
}

.form-check-label {
	color: #495057;
	font-size: 0.9rem;
	cursor: pointer;
	transition: color 0.2s ease;
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.form-check-label:hover {
	color: #ff6b35;
}

.form-check-input {
	cursor: pointer;
	margin-top: 0;
}

.form-check-input:checked {
	background-color: #ff6b35;
	border-color: #ff6b35;
}

.form-group label {
	color: #495057;
	font-weight: 500;
	font-size: 0.9rem;
	margin-bottom: 0.5rem;
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

.btn-primary:disabled {
	background: #f8f9fa;
	color: #9ca3af;
	border-color: #e8e8e8;
	cursor: not-allowed;
	opacity: 0.6;
}
</style>
