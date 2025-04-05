# IoT Quiz System

The IoT Quiz System is a dynamic platform that transforms traditional quizzes into engaging, interactive experiences. Powered by M5StickC Plus devices, MQTT, and Next.js, this system delivers real-time question displays, instant response collection, and live score updates. An alternative Bluetooth solution is also available for baseline performance comparison.

## 🌟 Key Features

### Live Interactive Quizzes
- **Instant Question Display:** Real-time presentation of quiz questions on all connected devices.
- **Immediate Response Collection:** Seamlessly capture answers as participants submit them.
- **Live Score Updates:** Dynamic score tracking that refreshes instantly.
- **Dynamic Leaderboard:** Engage participants with a live leaderboard reflecting current standings.

### M5StickC Plus Integration
- **Hardware-Based Answer Submission:** Utilize tactile M5StickC Plus devices for fast and intuitive input.
- **Low-Latency Communication:** Experience minimal delays from submission to result.
- **Battery-Efficient Operation:** Designed for extended use with optimal power management.
- **Effortless Device Pairing:** Quick and simple pairing process gets devices connected in seconds.

### Robust Quiz Management
- **Diverse Question Types:** Supports multiple-choice and single-select questions for flexible quiz formats.
- **Adaptive Scoring System:** Points are scaled based on speed and accuracy of responses.
- **Session Management:** Easily create, manage, and monitor multiple quiz sessions in real time.

## Additional Benefits
- **Scalability:** Suitable for small classrooms to large-scale events.
- **User-Friendly Interface:** Intuitive design for both participants and administrators.

## 🔌 Connectivity Options

### MQTT-Based Communication
- **Robust Real-Time Messaging:** Utilizes an MQTT broker to handle real-time communication, ensuring low latency and scalability.
- **Secure and Reliable:** Supports TLS encryption for secure data transfer.
- **High Performance:** Capable of managing high connection volumes for large-scale events.
- **Seamless Integration:** Works in tandem with the Next.js frontend for live updates and interactivity.

### Bluetooth-Based Communication
- **Alternative Connectivity:** Provides a Bluetooth-based solution for baseline performance comparison.
- **Direct Device-to-Device Communication:** Enables simple, local connectivity without the need for an internet connection.
- **Energy Efficient:** Optimized for battery-powered operation on M5StickC Plus devices.
- **Simplicity:** Ideal for scenarios where a lightweight, short-range communication protocol is preferred.


## 🏗️ Architecture

### MQTT System Overview

```mermaid
graph TD
    F["Teacher Dashboard (Next.js)"]
    S["Server Cluster (API & MQTT Broker)"]
    D["MySQL Database (Quiz Details)"]
    R[(Redis Message Emitter)]
    MDB["MongoDB Persistence (MQTT State)"]
    M["M5StickC Plus (Edge Device)"]
    NTP["NTP Server (pool.ntp.org, time.nist.gov)"]

    F <-- "HTTPS API (TLS/SSL)" --> S
    S -- "MQTT over WSS (TLS)" --> F
    S <-- "MQTT (TLS)" --> M
    S -- "SQL Queries via ORM" --> D
    S -- "Event Propagation (Pub/Sub)" --> R
    S -- "Persist MQTT State" --> MDB
    M -- "NTP Sync" --> NTP
```

### BLE System Overview
```mermaid
graph TD
    A["M5StickC Plus Devices<br/>BLE Peripherals"]-->|Time Sync| F["NTP Server"] 
    A <-->|GATT Services| B["Central Server<br/>BLE Central and Quiz Management"]
    B -->|SQL Queries via ORM| C["Database<br/>MySQL"]
    B <-->|HTTPS API| D["Web Dashboard<br/>Teacher Interface"]
    B -->|WSS| D
```

### Quiz Session Flow

```mermaid
sequenceDiagram
    participant T as Teacher Dashboard
    participant S as Server (API & MQTT Broker)
    participant D as MySQL Database
    participant M as M5StickC Plus

    %% Device Authentication Phase (Only for MQTT)
    M->>S: MQTT CONNECT (MAC Address, Password)
    S->>D: Validate credentials (device_credentials table)
    alt Credentials Valid & Active
        S-->>M: Connection Accepted
    else Invalid Credentials
        S-->>M: Connection Rejected
    end

    %% Quiz Creation and Authorization Broadcast
    T->>S: POST /api/quiz/create<br/>(sessionName, quizQuestions, tapSequence)
    S->>D: Store session, questions, options
    S-->>T: Return sessionId

    T->>S: POST /api/quiz/auth<br/>(sessionId)
    S->>D: Retrieve session details (tapSequence)
    S->>M: Publish "quiz/auth"<br/>(sessionName, tapSequence)
    S-->>T: Auth code broadcasted

    %% M5Stick joins session by sending tap sequence
    M->>S: Publish "quiz/session/join"<br/>(sessionId, tapSequenceInput)
    S->>D: Lookup session tap sequence
    alt Tap sequence matches
        S->>M: Accept join (mark as authorized)
        S->>S: Update in-memory client record
        S->>M: Publish "system/client/<id>/info"<br/>(authorized: true)
        S-->>T: (Updated client info available)
    else Tap sequence does not match
        S->>M: Reject join (invalid tap sequence)
    end

    %% Starting the Quiz Session
    T->>S: POST /api/quiz/start<br/>(sessionId)
    S->>D: Update session status to active
    S->>M: Publish "quiz/session/start"<br/>(sessionName)
    S-->>T: Session started

    %% For Each Question
    loop For Each Question
        T->>S: POST /api/quiz/broadcast<br/>(sessionId, questionIndex)
        S->>M: Publish "quiz/question"<br/>(question, options, timestamp, type)
        M->>S: Publish "quiz/response"<br/>(answer, timestamp)
        S->>D: Update/Insert response, compute score
        S->>T: Publish "quiz/answers/distribution"<br/>(answerDistribution)
    end

    %% End Quiz Session
   
    par
      T->>S: POST /api/quiz/end<br/>(sessionId)
      S->>D: Update session status to completed
      S->>M: Publish "quiz/end"<br/>(Quiz Ended)
    and
      T->>S: GET /api/quiz/leaderboard<br/>(sessionId)
      S-->>T: Return leaderboard
    end
```

### Database Schema Relationships

```mermaid
erDiagram
    sessions ||--o{ questions : contains
    questions ||--o{ options : has
    sessions ||--o{ players : joins
    players ||--o{ responses : submits
    responses }|--|| options : selects
    students ||--o{ players : has
    students ||--o{ device_credentials : owns

    sessions {
        uuid id
        string name
        string status
        string tapSequence
        json config
    }

    questions {
        uuid id
        uuid session_id
        string text
        string type
        int points
    }

    options {
        uuid id
        uuid question_id
        string text
        boolean is_correct
    }

    players {
        uuid id
        uuid session_id
        uuid student_id
        int score
    }

    responses {
        uuid id
        uuid player_id
        uuid option_id
        int response_time
        boolean is_correct
    }

    device_credentials {
        uuid id
        string mac_address
        string password
        uuid student_id
        boolean is_active
    }

    students {
        uuid id
        string full_name
    }
```

### 1. Frontend (Next.js)

- Modern web interface built with Next.js
- Real-time updates using MQTT or WSS
- Responsive design with Tailwind CSS
- Beautiful UI components from shadcn/ui
- MySQL database with Drizzle ORM

### 2. Server (MQTT Broker / BLE Central Server)

- Handles real-time communication
- Manages quiz sessions
- Processes responses
- Calculates scores
- Ensures low-latency operation
- Maintains performance under high connection volumes.

### 3. Edge Device (M5StickC Plus)

- Compact IoT device for answer input
- Quick response buttons
- Display for feedback
- Battery-powered operation
- WiFi or BLE connectivity

## 🛜 Getting Started (MQTT)

### Prerequisites

- Node.js 18+
- pnpm
- MySQL 8.0+
- MongoDB
- Redis
- Openssl
- M5StickC Plus device(s)
- Arduino IDE with M5StickC Plus support

### Installation 

1. **Clone the repository**

   ```bash
   git clone https://github.com/jiaweing/IoT-Quiz
   cd IoT-Quiz
   ```

2. **Install dependencies**

   ```bash
   # Frontend
   cd "Wifi - MQTT/frontend"
   pnpm install

   # Server
   cd ../server
   pnpm install

   # --- MongoDB Installation ---
   # Choose the instructions for your platform:

   # For macOS (using Homebrew):
   brew tap mongodb/brew
   brew install mongodb-community@4.4
   brew services start mongodb-community@4.4

   # For Windows:
   # Download the MongoDB Community Server installer from:
   # https://www.mongodb.com/try/download/community
   # Follow the installation instructions, and optionally install MongoDB as a Windows service.

   # --- Redis Installation ---
   # Choose the instructions for your platform:
   # For macOS (using Homebrew):
   brew install redis
   brew services start redis

   # For Windows:
   wsl --install
   sudo apt-get install lsb-release curl gpg
   curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
   sudo chmod 644 /usr/share/keyrings/redis-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
   sudo apt-get update
   sudo apt-get install redis
   sudo service redis-server start
   ```

3. **Configure environment variables**

   ```bash
   # Server (.env)
   cp server/.env.example server/.env
   # Edit the .env file with your configuration
   ```

4. **Setup database**

   ```bash
   cd server
   pnpm db:generate   # Generate migrations
   pnpm db:push      # Push to database
   ```

5. **Configure TLS**

   ```bash
   # Install on Windows
   choco install mkcert

   # Install on macOS
   brew install mkcert

   mkcert -install

   cd server/certificates
   # Edit the cert.cnf file and replace CN and IP.1 with your server IP address
   
   mkcert -CAROOT
   # Go to the path returned and copy "rootCA.pem" and "rootCA-key.pem" into server/certificates

   openssl genrsa -out server.key 2048
   openssl req -new -key server.key -out server.csr -config cert.cnf -reqexts req_ext
   openssl x509 -req -in server.csr -CA rootca.pem -CAkey rootca-key.pem -CAcreateserial -out server.crt -days 365 -sha256 -extensions req_ext

   mkcert <SERVER_IP> localhost 127.0.0.1 ::1 # Replace <SERVER_IP> with your own server ip
   # Rename generated files: "xx.pem" and "xx-key.pem" to "https.pem" and "http-key.pem"
   ```

6. **Flash M5StickC Plus**
   - Open `Wifi - MQTT/client/client.ino` in Arduino IDE
   - Add the files `Wifi - MQTT/client/client.cpp` and `Wifi - MQTT/client/config.h` to the sketch
   - Configure WiFi credentials on `Wifi - MQTT/client/client.cpp`
   - Upload to device

## ᚼᛒ Getting Started (BLE)

### Prerequisites

- Node.js 18+
- pnpm
- MySQL 8.0+
- MongoDB
- Openssl
- M5StickC Plus device(s)
- Arduino IDE with M5StickC Plus support

### Installation 

1. **Clone the repository**

   ```bash
   git clone https://github.com/jiaweing/IoT-Quiz
   cd IoT-Quiz
   ```

2. **Install dependencies**

   ```bash
   # Frontend
   cd "Bluetooth - GATT/frontend"
   pnpm install

   # Server
   cd ../server
   pnpm install

   # --- MongoDB Installation ---
   # Choose the instructions for your platform:

   # For macOS (using Homebrew):
   brew tap mongodb/brew
   brew install mongodb-community@4.4
   brew services start mongodb-community@4.4

   # For Windows:
   # Download the MongoDB Community Server installer from:
   # https://www.mongodb.com/try/download/community
   # Follow the installation instructions, and optionally install MongoDB as a Windows service.
   ```

3. **Configure environment variables**

   ```bash
   # Server (.env)
   cp server/.env.example server/.env
   # Edit the .env file with your configuration
   ```

4. **Setup database**

   ```bash
   cd server
   pnpm db:generate   # Generate migrations
   pnpm db:push      # Push to database
   ```

5. **Configure TLS**

   ```bash
   # Install on Windows
   choco install mkcert

   # Install on macOS
   brew install mkcert

   mkcert -install

   cd server/certificates
   # Edit the cert.cnf file and replace CN and IP.1 with your server IP address
   
   mkcert -CAROOT
   # Go to the path returned and copy "rootCA.pem" and "rootCA-key.pem" into server/certificates

   mkcert <SERVER_IP> localhost 127.0.0.1 ::1 # Replace <SERVER_IP> with your own server ip
   # Rename generated files: "xx.pem" and "xx-key.pem" to "https.pem" and "http-key.pem"
   ```

6. **Flash M5StickC Plus**
   - Open `Bluetooth - GATT/client/client.ino` in Arduino IDE
   - Upload to device


## 🎮 Usage

1. **Start the server**

   ```bash
   cd server
   pnpm dev
   ```

2. **Start the frontend**

   ```bash
   cd frontend
   pnpm dev
   ```

3. **Access the application**

   - Open `https://localhost:3000` in your browser
   - Create a new quiz session
   - Share the session code with participants

4. **Using M5StickC Plus**
   - Power on the device
   - Wait for WiFi connection
   - Enter the session code
   - Start answering questions!

## 💻 Development

### Project Structure

```
IoT/
├── wifi-mqtt/              # MQTT-based quiz system
│   ├── frontend/           # Next.js frontend for MQTT solution
│   │   ├── app/            # Pages and routing
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom React hooks
│   │   └── public/         # Static assets
│   ├── server/             # MQTT broker and server logic
│   │   ├── src/            # Server source code
│   │   └── db/             # Database schema and migrations
│   └── client/             # M5StickC Plus client for MQTT
│       └── client.ino      # Arduino sketch
├── bluetooth-gatt/         # Bluetooth GATT-based quiz system
│   ├── frontend/           # Next.js frontend for BLE solution
│   │   ├── app/            # Pages and routing
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom React hooks
│   │   └── public/         # Static assets
│   ├── server/             # BLE quiz server (Node.js)
│   └── client/             # M5StickC Plus client for BLE
│       └── client.ino      # Arduino sketch for BLE communication
├── tests/                  # Automated test scripts
│   ├── scripts/            # MQTT security and stress test scripts
│   └── data                # Latency and Delivery Rate data logged on server

```

### Adding New Features

1. Create a feature branch
2. Implement your changes
3. Add tests if applicable
4. Submit a pull request
5. Update documentation

## 📝 Contributing

Contributions are welcome! Please read our contributing guidelines for details on our code of conduct and the process for submitting pull requests.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) for the frontend framework
- [shadcn/ui](https://ui.shadcn.com/) for beautiful UI components
- [MQTT.js](https://github.com/mqttjs/MQTT.js) for real-time communication
- [M5Stack](https://m5stack.com/) for the M5StickC Plus hardware
- [Drizzle ORM](https://orm.drizzle.team/) for database management
