from wsgi import app
from CTFd.models import db
from flask_migrate import stamp

with app.app_context():
    db.create_all()
    stamp()
    print("Database initialized and stamped successfully!")
