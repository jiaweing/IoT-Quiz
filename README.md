# IoT Quiz System

A real-time interactive quiz system powered by M5StickC Plus devices with MQTT and Next.js. Perfect for classrooms, events, and interactive learning sessions.

## 🌟 Features

- **Live Interactive Quizzes**

  - Real-time question display
  - Instant response collection
  - Live score updates
  - Dynamic leaderboard

- **M5StickC Plus Integration**

  - Hardware-based answer submission
  - Low-latency response time
  - Battery-efficient operation
  - Easy device pairing

- **Rich Quiz Management**
  - Multiple choice questions
  - True/False questions
  - Configurable time limits
  - Point-based scoring system
  - Session management

## 🏗️ Architecture

### System Overview

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

### Quiz Session Flow

```mermaid
sequenceDiagram
    participant T as Teacher Dashboard
    participant S as Server (API & MQTT Broker)
    participant D as MySQL Database
    participant M as M5StickC Plus

    %% Quiz Creation and Authorization Broadcast
    T->>S: POST /api/quiz/create<br/>(sessionName, quizQuestions, tapSequence)
    S->>D: Store session, questions, options
    S-->>T: Return sessionId

    T->>S: POST /api/quiz/auth<br/>(sessionId)
    S->>D: Retrieve session details (including tap sequence)
    S->>M: Publish "quiz/auth"<br/>(sessionName, tapSequence)
    S-->>T: Auth code broadcasted

    %% M5Stick joins session by sending tap sequence
    M->>S: Publish "quiz/session/join"<br/>(sessionId, tapSequenceInput)
    S->>D: Lookup session tap sequence
    alt Tap sequence matches
        S->>M: Accept join (mark as authenticated)
        S->>S: Update in-memory client record
        S->>M: Publish updated "system/client/<id>/info"<br/>(authenticated: true)
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
        S->>M: Publish "quiz/question"<br/>(question, options, timestamp)
        M->>S: Publish "quiz/response"<br/>(answer, timestamp)
        S->>D: Update/Insert response, compute score
        S->>T: Publish "quiz/answers/distribution" <br/> (answerDistribution)
    end

    %% End Quiz Session
   
    par
      T->>S: POST /api/quiz/end<br/>(sessionId)
      S->>D: Update session status
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
        string device_id
        int score
    }

    responses {
        uuid id
        uuid player_id
        uuid option_id
        int response_time
        boolean is_correct
    }
```

### 1. Frontend (Next.js)

- Modern web interface built with Next.js
- Real-time updates using MQTT
- Responsive design with Tailwind CSS
- Beautiful UI components from shadcn/ui
- MySQL database with Drizzle ORM

### 2. Server (MQTT Broker)

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
- WiFi connectivity

## 🚀 Getting Started

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
   cd frontend
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
   - Open `client/client.ino` in Arduino IDE
   - Configure WiFi credentials
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
├── frontend/           # Next.js frontend application
│   ├── app/           # Pages and routing
│   ├── components/    # React components
│   ├── hooks/        # Custom React hooks
│   └── public/       # Static assets
├── server/           # MQTT broker and quiz logic
│   |── src/         # Server source code
│   |── db/           # Database schema and migrations
└── client/            # M5StickC Plus code
    └── client.ino     # Arduino sketch
```

### Database Schema

The system uses a MySQL database with the following structure:

- `sessions`: Quiz session management
- `questions`: Quiz questions and configuration
- `options`: Answer options for questions
- `players`: Participant tracking
- `responses`: User responses and scoring

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
