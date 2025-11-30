from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'stalk_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*")

# दोन वेगळ्या रांगा (Queues)
waiting_queues = {
    'video': None,
    'text': None
}

users_in_room = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('find_partner')
def find_partner(data):
    mode = data.get('mode') # 'video' किंवा 'text'
    sender_sid = request.sid

    print(f"User {sender_sid} looking for {mode} chat")

    # त्याच मोडमध्ये कोणी वेटिंगला आहे का ते बघा
    if waiting_queues[mode] and waiting_queues[mode] != sender_sid:
        partner_sid = waiting_queues[mode]
        waiting_queues[mode] = None  # रांगेतून काढा
        
        # रूम आयडी तयार करा
        room_id = f"{mode}_{partner_sid}_{sender_sid}"
        join_room(room_id, sid=partner_sid)
        join_room(room_id, sid=sender_sid)
        
        users_in_room[partner_sid] = room_id
        users_in_room[sender_sid] = room_id

        # दोघांना कळवा (Initiator तो असेल जो आधी आला होता)
        emit('match_found', {'room_id': room_id, 'mode': mode, 'initiator': True}, to=partner_sid)
        emit('match_found', {'room_id': room_id, 'mode': mode, 'initiator': False}, to=sender_sid)
        
    else:
        # कोणीच नाही, वेटिंगला थांबा
        waiting_queues[mode] = sender_sid
        emit('waiting', to=sender_sid)

@socketio.on('signal')
def handle_signal(data):
    # फक्त व्हिडिओ मोडसाठी WebRTC सिग्नल
    room_id = data.get('room')
    emit('signal', data, room=room_id, include_self=False)

@socketio.on('send_message')
def handle_message(data):
    room_id = data.get('room')
    msg = data.get('message')
    emit('receive_message', msg, room=room_id, include_self=False)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    
    # दोन्ही रांगा तपासा आणि काढून टाका
    for mode in ['video', 'text']:
        if waiting_queues[mode] == sid:
            waiting_queues[mode] = None

    # जर रूममध्ये असेल तर पार्टनरला सांगा
    if sid in users_in_room:
        room_id = users_in_room[sid]
        emit('partner_disconnected', room=room_id, include_self=False)
        del users_in_room[sid]

if __name__ == '__main__':
    socketio.run(app, debug=True)