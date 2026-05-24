<template>
  <div>
    <div class="form-group">
      <label>Search Users</label>
      <input
        type="text"
        class="form-control"
        placeholder="Search for users"
        v-model="searchedName"
        @keyup.down="moveCursor('down')"
        @keyup.up="moveCursor('up')"
        @keyup.enter="selectUser()"
      />
    </div>
    <div class="form-group">
      <span
        class="badge badge-primary mr-1"
        v-for="user in selectedUsers"
        :key="user.id"
      >
        {{ user.name }}
        <a class="btn-fa" @click="removeSelectedUser(user.id)"> &#215;</a>
      </span>
    </div>
    <div class="form-group">
      <div
        class="text-center"
        v-if="
          userResults.length == 0 &&
          this.searchedName != '' &&
          awaitingSearch == false
        "
      >
        <span class="text-muted"> No users found </span>
      </div>
      <ul class="list-group">
        <li
          :class="{
            'list-group-item': true,
            'd-flex': true,
            'justify-content-between': true,
            'align-items-center': true,
            active: idx === selectedResultIdx && user.verified === true,
            'list-group-item-secondary': user.verified !== true,
          }"
          :style="user.verified !== true ? 'cursor: not-allowed; opacity: 0.65;' : 'cursor: pointer;'"
          v-for="(user, idx) in userResults"
          :key="user.id"
          @click="user.verified === true && selectUser(idx)"
        >
          <span>{{ user.name }}</span>
          <span class="ml-2">
            <small
              v-if="user.verified !== true"
              class="text-danger"
            >
              unverified
            </small>
            <small
              v-else-if="contestMemberIds.includes(user.id)"
              :class="{
                'text-white': idx === selectedResultIdx,
                'text-muted': idx !== selectedResultIdx,
              }"
            >
              already in a team
            </small>
          </span>
        </li>
      </ul>
    </div>
    <div class="form-group">
      <button
        class="btn btn-primary d-inline-block float-right"
        @click="addUsers()"
      >
        Add Users
      </button>
    </div>
  </div>
</template>

<script>
import CTFd from "../../compat/CTFd";

export default {
  name: "UserAddForm",
  props: {
    team_id: Number,
    contest_id: Number,
  },
  data: function () {
    return {
      searchedName: "",
      awaitingSearch: false,
      emptyResults: false,
      userResults: [],
      selectedResultIdx: 0,
      selectedUsers: [],
      contestMemberIds: [],
    };
  },
  mounted: function () {
    this.loadContestMembers();
  },
  methods: {
    loadContestMembers: function () {
      if (!this.$props.contest_id) return;
      CTFd.fetch(`/admin/contests/${this.$props.contest_id}/member_ids`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then((r) => r.json())
        .then((r) => {
          if (r.success) {
            this.contestMemberIds = r.data;
          }
        });
    },
    searchUsers: function () {
      this.selectedResultIdx = 0;
      if (this.searchedName == "") {
        this.userResults = [];
        return;
      }

      CTFd.fetch(`/api/v1/users?view=admin&field=name&q=${this.searchedName}`, {
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
            this.userResults = response.data;
          }
        });
    },
    moveCursor: function (dir) {
      switch (dir) {
        case "up":
          if (this.selectedResultIdx) {
            this.selectedResultIdx -= 1;
          }
          break;
        case "down":
          if (this.selectedResultIdx < this.userResults.length - 1) {
            this.selectedResultIdx += 1;
          }
          break;
      }
    },
    selectUser: function (idx) {
      if (idx === undefined) {
        idx = this.selectedResultIdx;
      }
      let user = this.userResults[idx];

      // Block unverified users from being selected
      if (user.verified !== true) {
        return;
      }

      // Avoid duplicates
      const found = this.selectedUsers.some(
        (searchUser) => searchUser.id === user.id
      );
      if (found === false) {
        this.selectedUsers.push(user);
      }

      this.userResults = [];
      this.searchedName = "";
    },
    removeSelectedUser: function (user_id) {
      this.selectedUsers = this.selectedUsers.filter(
        (user) => user.id !== user_id
      );
    },
    handleAddUsersRequest: function () {
      let reqs = [];

      this.selectedUsers.forEach((user) => {
        let body = { user_id: user.id };
        reqs.push(
          CTFd.fetch(`/api/v1/teams/${this.$props.team_id}/members`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          })
        );
      });

      return Promise.all(reqs);
    },
    addUsers: function () {
      this.handleAddUsersRequest().then((_resps) => {
        window.location.reload();
      });
    },
  },
  watch: {
    searchedName: function (val) {
      if (this.awaitingSearch === false) {
        // 1 second delay after typing
        setTimeout(() => {
          this.searchUsers();
          this.awaitingSearch = false;
        }, 1000);
      }
      this.awaitingSearch = true;
    },
  },
};
</script>

<style scoped></style>
