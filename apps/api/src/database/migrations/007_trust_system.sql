-- =============================================================================
-- Migration 007: Trust, Support and System
-- ratings: UNIQUE on booking_id (one rating per ride per direction).
-- platform_settings: key-value store with JSON values; default rows inserted.
-- =============================================================================

USE ride_master;

-- ── ratings ───────────────────────────────────────────────────────────────────
CREATE TABLE ratings (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)         NOT NULL,
  booking_id     BIGINT UNSIGNED  NOT NULL,
  rider_id       BIGINT UNSIGNED  NOT NULL,
  driver_id      BIGINT UNSIGNED  NOT NULL,
  company_id     BIGINT UNSIGNED  NOT NULL,
  driver_score   TINYINT UNSIGNED NOT NULL,
  company_score  TINYINT UNSIGNED NOT NULL,
  comment        TEXT             NULL,
  created_at     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ratings_public_id  (public_id),
  UNIQUE KEY uq_ratings_booking_id (booking_id) COMMENT 'One rating per booking',
  CONSTRAINT chk_ratings_driver_score  CHECK (driver_score  BETWEEN 1 AND 5),
  CONSTRAINT chk_ratings_company_score CHECK (company_score BETWEEN 1 AND 5),
  CONSTRAINT fk_ratings_booking FOREIGN KEY (booking_id) REFERENCES bookings  (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ratings_rider   FOREIGN KEY (rider_id)   REFERENCES users      (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ratings_driver  FOREIGN KEY (driver_id)  REFERENCES drivers    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ratings_company FOREIGN KEY (company_id) REFERENCES companies  (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_ratings_driver_id  ON ratings (driver_id);
CREATE INDEX idx_ratings_company_id ON ratings (company_id);

-- ── rider_ratings ─────────────────────────────────────────────────────────────
-- Drivers rate riders. Repeated bad scores can trigger warning or ban.
CREATE TABLE rider_ratings (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)         NOT NULL,
  booking_id  BIGINT UNSIGNED  NOT NULL,
  driver_id   BIGINT UNSIGNED  NOT NULL,
  rider_id    BIGINT UNSIGNED  NOT NULL,
  score       TINYINT UNSIGNED NOT NULL,
  comment     TEXT             NULL,
  created_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rider_ratings_public_id  (public_id),
  UNIQUE KEY uq_rider_ratings_booking_id (booking_id) COMMENT 'One rider rating per booking',
  CONSTRAINT chk_rider_ratings_score CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT fk_rr_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rr_driver  FOREIGN KEY (driver_id)  REFERENCES drivers  (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rr_rider   FOREIGN KEY (rider_id)   REFERENCES users    (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_rider_ratings_rider_id ON rider_ratings (rider_id);

-- ── complaints ────────────────────────────────────────────────────────────────
CREATE TABLE complaints (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)         NOT NULL,
  booking_id     BIGINT UNSIGNED  NULL,
  raised_by      BIGINT UNSIGNED  NOT NULL,
  against_type   VARCHAR(20)      NOT NULL,
  category       VARCHAR(100)     NOT NULL,
  description    TEXT             NOT NULL,
  status         VARCHAR(20)      NOT NULL DEFAULT 'open',
  resolution     TEXT             NULL,
  resolved_by    BIGINT UNSIGNED  NULL,
  created_at     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at    DATETIME(3)      NULL,
  updated_at     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_complaints_public_id (public_id),
  CONSTRAINT chk_complaints_against_type CHECK (against_type IN ('driver','company','rider')),
  CONSTRAINT chk_complaints_status       CHECK (status IN ('open','investigating','resolved','closed')),
  CONSTRAINT fk_complaints_booking     FOREIGN KEY (booking_id)  REFERENCES bookings (id) ON DELETE SET NULL,
  CONSTRAINT fk_complaints_raised_by   FOREIGN KEY (raised_by)   REFERENCES users    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_resolved_by FOREIGN KEY (resolved_by) REFERENCES users    (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_complaints_raised_by ON complaints (raised_by);
CREATE INDEX idx_complaints_status    ON complaints (status);

-- ── notifications ─────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id  CHAR(26)         NOT NULL,
  user_id    BIGINT UNSIGNED  NOT NULL,
  channel    VARCHAR(20)      NOT NULL DEFAULT 'in_app',
  title      VARCHAR(200)     NOT NULL,
  body       TEXT             NOT NULL,
  data       JSON             NULL     COMMENT 'Extra payload (e.g. bookingId)',
  read_at    DATETIME(3)      NULL,
  sent_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_public_id (public_id),
  CONSTRAINT chk_notifications_channel CHECK (channel IN ('push','sms','in_app')),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_notifications_user_id ON notifications (user_id, read_at);

-- ── audit_logs ────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  actor_user_id   BIGINT UNSIGNED  NULL     COMMENT 'NULL for system actions',
  action          VARCHAR(100)     NOT NULL,
  entity_type     VARCHAR(100)     NOT NULL,
  entity_id       VARCHAR(50)      NULL,
  old_value       JSON             NULL,
  new_value       JSON             NULL,
  ip_address      VARCHAR(45)      NULL,
  request_id      VARCHAR(100)     NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_audit_logs_public_id (public_id),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs (actor_user_id);
CREATE INDEX idx_audit_logs_entity        ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_action        ON audit_logs (action, created_at);

-- ── platform_settings ─────────────────────────────────────────────────────────
CREATE TABLE platform_settings (
  setting_key VARCHAR(100)  NOT NULL,
  value       JSON          NOT NULL COMMENT 'JSON value (number, string, boolean)',
  description VARCHAR(500)  NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_ps_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Default platform settings
INSERT INTO platform_settings (setting_key, value, description) VALUES
  ('default_commission_bps',              '1000',   '10% commission in basis points'),
  ('request_timeout_seconds',             '60',     'Seconds before a ride request expires'),
  ('search_radius_km',                    '10',     'Radius to search for online drivers'),
  ('cancellation_window_seconds',         '300',    'Seconds after acceptance when rider can cancel for free'),
  ('cancellation_fee_laari',              '0',      'Fee charged for late cancellation (0 = free in MVP)'),
  ('individual_vehicle_limit',            '3',      'Max vehicles for individual operator'),
  ('new_company_starting_credit_laari',   '50000',  '500 MVR starting credit for new companies'),
  ('min_online_drivers',                  '1',      'Min online drivers before a route is shown to riders'),
  ('gst_rate_bps',                        '0',      'GST rate in basis points (0 until confirmed)'),
  ('daily_sms_budget',                    '1000',   'Max SMS messages per day before alert'),
  ('booking_locations_retention_days',    '90',     'Days to keep booking_locations before deletion');

INSERT INTO schema_migrations (version) VALUES ('007_trust_system');
