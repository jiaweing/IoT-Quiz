import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// Sessions table for managing live quiz instances
export const sessions = mysqlTable("sessions", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, active, completed
  tapSequence: varchar("tap_sequence", {length: 10}).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
  config: json("config")
    .$type<{
      timePerQuestion: number;
      showLeaderboard: boolean;
    }>()
    .default({
      timePerQuestion: 30,
      showLeaderboard: true,
    }),
});

// Questions table
export const questions = mysqlTable(
  "questions",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    text: text("text").notNull(),
    type: varchar("type", { length: 20 }).notNull().default("multiple_choice"), // multiple_choice, true_false
    points: int("points").notNull().default(1000),
    timeLimit: int("time_limit").notNull().default(30), // seconds
    order: int("order").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
  },
  (table) => ({
    sessionIdx: index("session_idx").on(table.sessionId),
  })
);

// Options/Answers for questions
export const options = mysqlTable(
  "options",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID
    questionId: varchar("question_id", { length: 36 }).notNull(),
    text: varchar("text", { length: 255 }).notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    order: int("order").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
  },
  (table) => ({
    questionIdx: index("question_idx").on(table.questionId),
  })
);

// Players/Participants
export const players = mysqlTable(
  "players",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    deviceId: varchar("device_id", { length: 100 }).notNull(), // M5StickC Plus device ID
    name: varchar("name", { length: 100 }).notNull(),
    score: int("score").notNull().default(0),
    joinedAt: timestamp("joined_at").defaultNow(),
    lastActive: timestamp("last_active").defaultNow().onUpdateNow(),
  },
  (table) => ({
    sessionIdx: index("session_player_idx").on(table.sessionId),
    deviceIdx: index("device_idx").on(table.deviceId),
  })
);

// Player responses to questions
export const responses = mysqlTable(
  "responses",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    questionId: varchar("question_id", { length: 36 }).notNull(),
    playerId: varchar("player_id", { length: 36 }).notNull(),
    optionId: varchar("option_id", { length: 36 }).notNull(),
    responseTime: int("response_time").notNull(), // milliseconds
    isCorrect: boolean("is_correct").notNull(),
    pointsAwarded: int("points_awarded").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sessionIdx: index("session_response_idx").on(table.sessionId),
    playerIdx: index("player_response_idx").on(table.playerId),
    questionIdx: index("question_response_idx").on(table.questionId),
    uniqueResponse: primaryKey(table.questionId, table.playerId), // One response per question per player
  })
);
