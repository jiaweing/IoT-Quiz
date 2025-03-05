CREATE TABLE `options` (
	`id` varchar(36) NOT NULL,
	`question_id` varchar(36) NOT NULL,
	`text` varchar(255) NOT NULL,
	`is_correct` boolean NOT NULL DEFAULT false,
	`order` int NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`device_id` varchar(100) NOT NULL,
	`name` varchar(100) NOT NULL,
	`score` int NOT NULL DEFAULT 0,
	`joined_at` timestamp DEFAULT (now()),
	`last_active` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `players_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`text` text NOT NULL,
	`type` varchar(20) NOT NULL DEFAULT 'multiple_choice',
	`points` int NOT NULL DEFAULT 1000,
	`time_limit` int NOT NULL DEFAULT 30,
	`order` int NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`question_id` varchar(36) NOT NULL,
	`player_id` varchar(36) NOT NULL,
	`option_id` varchar(36) NOT NULL,
	`response_time` int NOT NULL,
	`is_correct` boolean NOT NULL,
	`points_awarded` int NOT NULL DEFAULT 0,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `responses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`config` json DEFAULT ('{"timePerQuestion":30,"showLeaderboard":true}'),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `question_idx` ON `options` (`question_id`);--> statement-breakpoint
CREATE INDEX `session_player_idx` ON `players` (`session_id`);--> statement-breakpoint
CREATE INDEX `device_idx` ON `players` (`device_id`);--> statement-breakpoint
CREATE INDEX `session_idx` ON `questions` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_response_idx` ON `responses` (`session_id`);--> statement-breakpoint
CREATE INDEX `player_response_idx` ON `responses` (`player_id`);--> statement-breakpoint
CREATE INDEX `question_response_idx` ON `responses` (`question_id`);