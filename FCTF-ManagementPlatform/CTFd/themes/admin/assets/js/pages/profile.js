import "./main";
import $ from "jquery";
import "../compat/json";
import "../compat/format";
import CTFd from "../compat/CTFd";
import { ezBadge } from "../compat/ezq";

function updateProfile(event) {
  event.preventDefault();

  const $form = $("#profile-edit-form");
  const $results = $("#results");
  const params = $form.serializeJSON(true);

  $results.empty();
  $form.find(".form-control").removeClass("input-filled-invalid");

  CTFd.fetch("/api/v1/users/me", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  })
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      if (response.success) {
        $("#profile-confirm").val("");
        $("#profile-password").val("");

        $results.append(
          ezBadge({
            type: "success",
            body: "Your profile has been updated",
          }),
        );
      } else {
        Object.keys(response.errors).forEach(function (key, _index) {
          $results.append(
            ezBadge({
              type: "error",
              body: response.errors[key],
            }),
          );
          const input = $form.find("input[name={0}]".format(key));
          input.addClass("input-filled-invalid");
        });
      }
    });
}

$(() => {
  $("#profile-edit-form").submit(updateProfile);
});
