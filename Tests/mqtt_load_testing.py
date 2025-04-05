import paho.mqtt.client as mqtt
import ssl
import time
import uuid
import json
import threading
import csv
import random
import requests
from datetime import datetime

# --- Configuration ---
LOG_FILE = "mqtt_test_log.csv"
MQTT_BROKER = "192.168.1.19"
MQTT_PORT = 8883
CA_CERT_PATH = "../Wifi - MQTT/server/certificates/rootCA.pem"
REGISTER_ENDPOINT = "https://192.168.1.19:3001/api/register-device"  # adjust if different
SESSION_ID = "m939q5at-6vdw"
TAP_SEQUENCE = "ABA"
NUM_DEVICES = 200

# --- Initialize CSV logging ---
log_file = open(LOG_FILE, mode='w', newline='')
csv_writer = csv.writer(log_file)
csv_writer.writerow(["timestamp", "client_id", "event", "details"])

def log_event(client_id, event, details=""):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    csv_writer.writerow([timestamp, client_id, event, details])
    print(f"[{client_id}] {event} - {details}")

# --- Register simulated devices ---
def register_devices(num_devices):
    devices = []
    for i in range(num_devices):
        mac = f"SIMMAC{i:04X}"
        player_name = f"SimUser{i+1}"
        try:
            response = requests.post(REGISTER_ENDPOINT, json={
                "macAddress": mac,
                "playerName": player_name
            }, verify=False)  # Disable SSL verification for dev/testing
            result = response.json()
            if result.get("success"):
                devices.append({"mac": mac, "password": result["password"]})
                print(f"[REGISTER] {mac} registered")
            else:
                print(f"[REGISTER ERROR] {mac} - {result.get('error')}")
        except Exception as e:
            print(f"[REGISTER EXCEPTION] {mac} - {e}")
    return devices

# --- Simulate MQTT client device ---
def simulate_device(device_info):
    mac = device_info["mac"]
    password = device_info["password"]
    client_id = f"{mac}_{uuid.uuid4().hex[:6]}"
    auth_event = threading.Event()
    start_event = threading.Event()
    question_event = threading.Event()
    question_data = {}

    def on_connect(client, userdata, flags, rc):
        log_event(client_id, "Connected")
        client.subscribe(f"system/client/{client_id}/info")
        client.subscribe("quiz/session/start")
        client.subscribe("quiz/question")
        client.publish("quiz/session/join", json.dumps({
            "sessionId": SESSION_ID,
            "auth": TAP_SEQUENCE
        }), qos=1)
        log_event(client_id, "Sent join request")

    def on_message(client, userdata, msg):
        topic = msg.topic
        try:
            if topic.endswith("/info"):
                payload = json.loads(msg.payload.decode())
                if payload.get("authenticated"):
                    log_event(client_id, "Authenticated")
                    auth_event.set()
            elif topic == "quiz/session/start":
                start_event.set()
            elif topic == "quiz/question":
                payload = json.loads(msg.payload.decode())
                question_data.update(payload)
                log_event(client_id, "Received question", payload.get("id", "N/A"))
                question_event.set()
        except Exception as e:
            log_event(client_id, "Message error", str(e))

    def send_response(client):
        if not question_data:
            return
        response = {
            "questionId": question_data["id"],
            "timestamp": int(time.time() * 1000)
        }
        options = question_data.get("options", [])
        ids = [o["id"] for o in options]
        if question_data.get("type") == "multi_select":
            selected = random.sample(ids, min(2, len(ids)))
            response["optionIds"] = selected
        else:
            response["optionId"] = random.choice(ids)
        client.publish("quiz/response", json.dumps(response), qos=1)
        log_event(client_id, "Sent response", str(response))

    client = mqtt.Client(client_id=client_id)
    client.username_pw_set(mac, password)
    client.tls_set(ca_certs=CA_CERT_PATH, tls_version=ssl.PROTOCOL_TLS)
    client.tls_insecure_set(True)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

    if not auth_event.wait(timeout=10):
        log_event(client_id, "Auth timeout")
        return
    if not start_event.wait(timeout=30):
        log_event(client_id, "Quiz start timeout")
        return
    if not question_event.wait(timeout=30):
        log_event(client_id, "Question timeout")
        return

    time.sleep(random.uniform(0.5, 2.0))  # Add randomness
    send_response(client)
    time.sleep(35)
    client.loop_stop()
    client.disconnect()

# --- Main Simulation ---
all_devices = register_devices(NUM_DEVICES)

threads = []
for device in all_devices:
    t = threading.Thread(target=simulate_device, args=(device,))
    t.start()
    threads.append(t)
    time.sleep(0.05)  # Light stagger to avoid collision

for t in threads:
    t.join()

print("✅ All simulated clients finished.")
