-- Create both databases on first run
CREATE DATABASE IF NOT EXISTS ride_master CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS ride_master_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Grant full privileges to app user on both databases
GRANT ALL PRIVILEGES ON ride_master.* TO 'ridemaster'@'%';
GRANT ALL PRIVILEGES ON ride_master_test.* TO 'ridemaster'@'%';
FLUSH PRIVILEGES;
