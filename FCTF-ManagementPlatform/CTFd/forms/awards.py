from wtforms import RadioField, StringField, TextAreaField
from wtforms.fields.html5 import IntegerField
from wtforms.validators import NumberRange

from CTFd.forms import BaseForm
from CTFd.forms.fields import SubmitField


class AwardCreationForm(BaseForm):
    name = StringField("Name")
    value = IntegerField("Value", default=0, validators=[NumberRange(min=0, message="Value must be 0 or greater")])
    category = StringField("Category")
    description = TextAreaField("Description")
    submit = SubmitField("Create")
    icon = RadioField(
        "Icon",
        choices=[
            ("", "None"),
            ("shield", "Shield"),
            ("bug", "Bug"),
            ("crown", "Crown"),
            ("crosshairs", "Crosshairs"),
            ("ban", "Ban"),
            ("lightning", "Lightning"),
            ("skull", "Skull"),
            ("brain", "Brain"),
            ("code", "Code"),
            ("cowboy", "Cowboy"),
            ("angry", "Angry"),
        ],
    )
