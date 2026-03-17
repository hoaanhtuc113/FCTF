from wtforms import BooleanField, FileField, SelectField, StringField
from wtforms.fields.html5 import IntegerField
from wtforms.widgets.html5 import NumberInput

from CTFd.constants.config import (
    AccountVisibilityTypes,
    ChallengeDifficultyVisibilityTypes,
    ChallengeVisibilityTypes,
    RegistrationVisibilityTypes,
    ScoreVisibilityTypes,
)
from CTFd.constants.languages import SELECT_LANGUAGE_LIST
from CTFd.forms import BaseForm
from CTFd.forms.fields import SubmitField
from CTFd.utils.csv import get_dumpable_tables


class ResetInstanceForm(BaseForm):
    accounts = BooleanField(
        "Accounts",
        description="Deletes all user and team accounts and their associated information",
    )
    submissions = BooleanField(
        "Submissions",
        description="Deletes all records that accounts gained points or took an action",
    )
    challenges = BooleanField(
        "Challenges", description="Deletes all challenges and associated data"
    )
    logs = BooleanField(
        "Logs",
        description="Deletes all action logs and admin audit logs",
    )
    submit = SubmitField("Reset CTF")


class AccountSettingsForm(BaseForm):
    team_creation = SelectField(
        "Team Creation",
        description="Control whether users can create their own teams (Teams mode only)",
        choices=[("true", "Enabled"), ("false", "Disabled")],
        default="true",
    )
    team_size = IntegerField(
        widget=NumberInput(min=0),
        description="Maximum number of users per team (Teams mode only)",
    )
    num_teams = IntegerField(
        "Maximum Number of Teams",
        widget=NumberInput(min=0),
        description="Maximum number of teams allowed to register with this CTF (Teams mode only)",
    )
    team_disbanding = SelectField(
        "Team Disbanding",
        description="Control whether team captains are allowed to disband their own teams",
        choices=[
            ("inactive_only", "Enabled for Inactive Teams"),
            ("disabled", "Disabled"),
        ],
        default="inactive_only",
    )
    name_changes = SelectField(
        "Name Changes",
        description="Control whether users and teams can change their names",
        choices=[("true", "Enabled"), ("false", "Disabled")],
        default="true",
    )
    incorrect_submissions_per_min = IntegerField(
        "Incorrect Submissions per Minute",
        widget=NumberInput(min=1),
        description="Number of submissions allowed per minute for flag bruteforce protection (default: 10)",
    )

    submit = SubmitField("Update")


class ExportCSVForm(BaseForm):
    table = SelectField("Database Table", choices=get_dumpable_tables())
    submit = SubmitField("Download CSV")


class ImportCSVForm(BaseForm):
    csv_type = SelectField(
        "CSV Type",
        choices=[("users", "Users"), ("teams", "Teams"), ("users_and_teams", "Users + Teams"), ("challenges", "Challenges")],
        description="Type of CSV data",
    )
    csv_file = FileField("CSV File", description="CSV file contents")


class VisibilitySettingsForm(BaseForm):
    challenge_visibility = SelectField(
        "Challenge Visibility",
        description="Control whether users must be logged in to see challenges",
        choices=[
            (ChallengeVisibilityTypes.PUBLIC, "Public"),
            (ChallengeVisibilityTypes.PRIVATE, "Private"),
            (ChallengeVisibilityTypes.ADMINS, "Admins Only"),
        ],
        default=ChallengeVisibilityTypes.PRIVATE,
    )
    account_visibility = SelectField(
        "Account Visibility",
        description="Control whether accounts (users & teams) are shown to everyone, only to authenticated users, or only to admins",
        choices=[
            (AccountVisibilityTypes.PUBLIC, "Public"),
            (AccountVisibilityTypes.PRIVATE, "Private"),
            (AccountVisibilityTypes.ADMINS, "Admins Only"),
        ],
        default=AccountVisibilityTypes.PUBLIC,
    )
    score_visibility = SelectField(
        "Score Visibility",
        description="Control whether solves/score are shown to the public, to logged in users, or hidden",
        choices=[
            (ScoreVisibilityTypes.PUBLIC, "Public"),
            (ScoreVisibilityTypes.PRIVATE, "Private"),
            (ScoreVisibilityTypes.HIDDEN, "Hidden"),
        ],
        default=ScoreVisibilityTypes.PUBLIC,
    )
    registration_visibility = SelectField(
        "Registration Visibility",
        description="Control whether registration is enabled for everyone or disabled",
        choices=[
            (RegistrationVisibilityTypes.PUBLIC, "Public"),
            (RegistrationVisibilityTypes.PRIVATE, "Private"),
            (RegistrationVisibilityTypes.MLC, "MajorLeagueCyber Only"),
        ],
        default=RegistrationVisibilityTypes.PUBLIC,
    )
    challenge_difficulty_visibility = SelectField(
        "Challenge Difficulty Visibility",
        description="Control whether the difficulty level of challenges is visible to contestants",
        choices=[
            (ChallengeDifficultyVisibilityTypes.ENABLED, "Enabled"),
            (ChallengeDifficultyVisibilityTypes.DISABLED, "Disabled"),
        ],
        default=ChallengeDifficultyVisibilityTypes.DISABLED,
    )


class LocalizationForm(BaseForm):
    default_locale = SelectField(
        "Default Language",
        description="Language to use if a user does not specify a language in their account settings. By default, CTFd will auto-detect the user's preferred language.",
        choices=SELECT_LANGUAGE_LIST,
    )
