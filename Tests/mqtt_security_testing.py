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

# Test 2: Unauthorized topic subscribe access with valid login (but no permission)
def on_connect_subscribe(client, userdata, flags, rc):
    if rc == 0:
        print("[INFO] Connected to broker for subscribe test.")
        print("[INFO] Attempting to subscribe to protected topic (expected to fail)...")
        client.subscribe(protected_topic)
    else:
        print(f"[ERROR] Connection failed with code {rc}")
    # Let the client run briefly before disconnecting
    time.sleep(3)
    client.disconnect()

def on_subscribe(client, userdata, mid, granted_qos):
    print(f"[RESULT] on_subscribe callback triggered. Granted QoS: {granted_qos}")

def on_log(client, userdata, level, buf):
    print(f"[LOG] {buf}")

client_subscribe = mqtt.Client(client_id="unauthorized-device-subscribe")
client_subscribe.username_pw_set("AC0BFB6F9C40", "Pass53142")
client_subscribe.tls_set(cert_reqs=ssl.CERT_NONE)  # Skip cert verification for testing
client_subscribe.tls_insecure_set(True)
client_subscribe.on_connect = on_connect_subscribe
client_subscribe.on_subscribe = on_subscribe
client_subscribe.on_log = on_log

print("\n[TEST] Starting unauthorized subscribe test...")
client_subscribe.connect(broker, port)
client_subscribe.loop_start()
time.sleep(3)
client_subscribe.disconnect()


# Test 3: Unauthorized topic publish access with valid login (but no permission)
def on_connect_publish(client, userdata, flags, rc):
    if rc == 0:
        print("[INFO] Connected to broker for publish test.")
        print("[INFO] Attempting to publish to protected topic (expected to fail)...")
        result = client.publish(protected_topic, "unauthorized publish attempt")
        status = result[0]
        if status == 0:
            print("[WARNING] Publish function executed. Check if the broker accepted it.")
        else:
            print("[RESULT] Publish failed at client level.")
    else:
        print(f"[ERROR] Connection failed with code {rc}")
    time.sleep(3)
    client.disconnect()

def on_publish(client, userdata, mid):
    print(f"[WARNING] on_publish callback triggered – mid: {mid}")

def on_log(client, userdata, level, buf):
    print(f"[LOG] {buf}")

client_publish = mqtt.Client(client_id="unauthorized-device-publish")
client_publish.username_pw_set("AC0BFB6F9C40", "Pass53142")
client_publish.tls_set(cert_reqs=ssl.CERT_NONE)  # Skip cert verification for testing
client_publish.tls_insecure_set(True)
client_publish.on_connect = on_connect_publish
client_publish.on_publish = on_publish
client_publish.on_log = on_log

print("\n[TEST] Starting unauthorized publish test...")
client_publish.connect(broker, port)
client_publish.loop_forever()