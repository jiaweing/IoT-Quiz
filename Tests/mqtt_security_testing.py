import time
import ssl
import paho.mqtt.client as mqtt

broker = "192.168.1.19"
port = 8883  # MQTT over TLS
protected_topic = "quiz/response"

# Test 1: Invalid Credentials (Authentication Failure)
def on_connect_invalid(client, userdata, flags, rc):
    if rc != 0:
        print("[RESULT] Connection with invalid credentials failed as expected. Return code:", rc)
    client.loop_stop()

client1 = mqtt.Client(client_id="rogue-device")
client1.username_pw_set("invalid-mac-address", "wrong-password")
client1.tls_set(cert_reqs=ssl.CERT_NONE)  # Skip verification for local testing
client1.tls_insecure_set(True)
client1.on_connect = on_connect_invalid
print("[TEST] Attempting connection with invalid credentials...")
client1.connect(broker, port)
client1.loop_start()
time.sleep(2)
client1.disconnect()

# Test 2: Unauthorized topic access with valid login (but no permission)
def on_connect_authorized(client, userdata, flags, rc):
    if rc == 0:
        print("[INFO] Connected to broker.")
        print("[INFO] Subscribing to topic (expected to succeed)...")
        client.subscribe(protected_topic)
        time.sleep(1)
        print("[TEST] Attempting to publish (expected to fail)...")
        result = client.publish(protected_topic, "unauthorized publish attempt")
        status = result[0]
        if status == 0:
            print("[WARNING] Publish function executed. Check if the broker accepted it.")
        else:
            print("[RESULT] Publish failed at client level.")
    else:
        print(f"[ERROR] Connection failed with code {rc}")

def on_subscribe(client, userdata, mid, granted_qos):
    print("[RESULT] Subscribed successfully (as expected)")

def on_publish(client, userdata, mid):
    print(f"[WARNING] on_publish callback triggered – mid: {mid}")

def on_log(client, userdata, level, buf):
    print(f"[LOG] {buf}")

def on_message(client, userdata, msg):
    print("[INFO] Message received:", msg.payload.decode())

client2 = mqtt.Client(client_id="unauthorized-device")
client2.username_pw_set("AC0BFB6F9C40", "Pass53142")
client2.tls_set(cert_reqs=ssl.CERT_NONE)
client2.tls_insecure_set(True)
client2.on_connect = on_connect_authorized
client2.on_subscribe = on_subscribe
client2.on_publish = on_publish
client2.on_log = on_log
client2.on_message = on_message

print("\n[TEST] Attempting unauthorized topic access...")
client2.connect(broker, port)
client2.loop_start()
time.sleep(5)
client2.disconnect()
