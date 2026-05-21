from flask import Blueprint

from CTFd.models import Challenges, Flags, db
from CTFd.plugins import register_plugin_assets_directory
from CTFd.plugins.challenges import CHALLENGE_CLASSES, BaseChallenge
from CTFd.plugins.migrations import upgrade
from textwrap import dedent

class MultipleChoiceChallenge(Challenges):
    __mapper_args__ = {"polymorphic_identity": "multiple_choice"}
    id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True
    )


    def __init__(self, *args, **kwargs):
        super(MultipleChoiceChallenge, self).__init__(**kwargs)


class MultipleChoiceChallengeClass(BaseChallenge):
    id = "multiple_choice"  # Unique identifier used to register challenges
    name = "multiple_choice"  # Name of a challenge type
    templates = {  # Handlebars templates used for each aspect of the challenge edit page
        "create": "/plugins/multiple_choice/assets/create.html",
        "update": "/plugins/multiple_choice/assets/update.html",
        "view": "/plugins/multiple_choice/assets/view.html",
    }
    scripts = {  # Scripts that are loaded when a template is loaded
        "create": "/plugins/multiple_choice/assets/create.js",
        "update": "/plugins/multiple_choice/assets/update.js",
        "view": "/plugins/multiple_choice/assets/view.js",
    }
    # Route at which files are accessible. This must begin with a slash
    route = "/plugins/multiple_choice/assets/"
    # Blueprint used to access the static_folder directory.
    blueprint = Blueprint(
        "multiple_choice_challenges",
        __name__,
        template_folder="templates",
        static_folder="assets",
    )
    challenge_model = MultipleChoiceChallenge

    @classmethod
    def read(cls, challenge):
        challenge = MultipleChoiceChallenge.query.filter_by(
            id=challenge.id).first()
        data = {
            "id": challenge.id,
            "name": challenge.name,
            "description": challenge.description,
            "max_attempts": challenge.max_attempts,
            "value": challenge.value,
            "category": challenge.category,
            "type": challenge.type,
            "state": challenge.state,
            "requirements": challenge.requirements,
            "connection_info": challenge.connection_info,
            "next_id": challenge.next_id,
            "time_limit": challenge.time_limit,
            "require_deploy": challenge.require_deploy,
            "deploy_status": challenge.deploy_status,
            "type_data": {
                "id": cls.id,
                "name": cls.name,
                "templates": cls.templates,
                "scripts": cls.scripts,
            },
        }
        return data

def modify_description(challenge):
    input_text = challenge.description

    if input_text and challenge.type == 'multiple_choice':
        try:
            lines = input_text.strip().split('\n')
            question_lines = []
            options = []

            for line in lines:
                line = line.strip()
                if line.startswith('* ()'):
                    options.append(line[4:].strip())
                else:
                    question_lines.append(line)

            if not question_lines or not options:
                raise ValueError("Invalid format")

            question = ' '.join(question_lines)
            description = f'''<div className="space-y-4">
                        <p className="text-lg font-medium mb-4">{question.strip()}<br /></p>'''

            for idx, option in enumerate(options):
                description += dedent(f"""
                    <div className="flex items-center"><input 
                            type="radio" 
                            name="radio-group" 
                            value="{option}" 
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500" 
                        /><label 
                            htmlFor="option-{idx}" 
                            className="ml-2 text-sm text-gray-700"
                        > {option}</label></div>""")

            description += '</div>'
            return description
        except Exception:
            return challenge.description
    return challenge.description
def load(app):
    upgrade(plugin_name="multiple_choice_challenges")
    CHALLENGE_CLASSES["multiple_choice"] = MultipleChoiceChallengeClass
    register_plugin_assets_directory(
        app, base_path="/plugins/multiple_choice/assets/"
    )

def modify_description(challenge):
    input_text = challenge.description

    if input_text and challenge.type == 'multiple_choice':
        try:
            lines = input_text.strip().split('\n')
            question_lines = []
            options = []

            for line in lines:
                line = line.strip()
                if line.startswith('* ()'):
                    options.append(line[4:].strip())
                else:
                    question_lines.append(line)

            if not question_lines or not options:
                raise ValueError("Invalid format")

            question = ' '.join(question_lines)
            description = f'''<div className="space-y-4">
                        <p className="text-lg font-medium mb-4">{question.strip()}<br /></p>'''

            for idx, option in enumerate(options):
                description += dedent(f"""
                    <div className="flex items-center"><input 
                            type="radio" 
                            name="radio-group" 
                            value="{option}" 
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500" 
                        /><label 
                            htmlFor="option-{idx}" 
                            className="ml-2 text-sm text-gray-700"
                        > {option}</label></div>""")

            description += '</div>'
            return description
        except Exception:
            return challenge.description
    return challenge.description