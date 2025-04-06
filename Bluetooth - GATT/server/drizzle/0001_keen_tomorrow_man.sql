CREATE TABLE `students` (
	`id` varchar(36) NOT NULL,
	`full_name` varchar(100) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `students_id` PRIMARY KEY(`id`)
);
