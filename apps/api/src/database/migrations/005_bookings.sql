-- =============================================================================
-- Migration 005: Bookings
-- idempotency_key: unique so double-tap never creates two bookings.
-- =============================================================================

USE ride_master;

-- ── saved_places ──────────────────────────────────────────────────────────────
CREATE TABLE saved_places (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id  CHAR(26)         NOT NULL,
  user_id    BIGINT UNSIGNED  NOT NULL,
  label      VARCHAR(100)     NOT NULL,
  address    VARCHAR(500)     NULL,
  lat        DECIMAL(10,7)    NOT NULL,
  lng        DECIMAL(10,7)    NOT NULL,
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_saved_places_public_id (public_id),
  CONSTRAINT fk_saved_places_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_saved_places_user_id ON saved_places (user_id);

-- ── bookings ──────────────────────────────────────────────────────────────────
CREATE TABLE bookings (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id           CHAR(26)         NOT NULL,
  idempotency_key     CHAR(36)         NOT NULL COMMENT 'UUID v4 from client',
  rider_id            BIGINT UNSIGNED  NOT NULL,
  company_id          BIGINT UNSIGNED  NOT NULL,
  driver_id           BIGINT UNSIGNED  NULL,
  vehicle_id          BIGINT UNSIGNED  NULL,
  vehicle_type_id     BIGINT UNSIGNED  NOT NULL,
  passengers          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  luggage_count       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- Pickup
  pickup_address      VARCHAR(500)     NULL,
  pickup_lat          DECIMAL(10,7)    NOT NULL,
  pickup_lng          DECIMAL(10,7)    NOT NULL,
  -- Dropoff
  dropoff_address     VARCHAR(500)     NULL,
  dropoff_lat         DECIMAL(10,7)    NOT NULL,
  dropoff_lng         DECIMAL(10,7)    NOT NULL,
  -- Areas
  from_area_id        BIGINT UNSIGNED  NOT NULL,
  to_area_id          BIGINT UNSIGNED  NOT NULL,
  -- Money (all in laari)
  quoted_price_laari  BIGINT UNSIGNED  NOT NULL,
  final_price_laari   BIGINT UNSIGNED  NULL,
  tax_laari           BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  commission_bps      INT UNSIGNED     NULL,
  commission_laari    BIGINT UNSIGNED  NULL,
  -- Payment
  payment_method      VARCHAR(20)      NOT NULL DEFAULT 'cash',
  payment_status      VARCHAR(20)      NOT NULL DEFAULT 'pending',
  -- State
  status              VARCHAR(40)      NOT NULL DEFAULT 'requested',
  -- Timestamps
  requested_at        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  accepted_at         DATETIME(3)      NULL,
  arrived_at          DATETIME(3)      NULL,
  started_at          DATETIME(3)      NULL,
  completed_at        DATETIME(3)      NULL,
  cancelled_at        DATETIME(3)      NULL,
  cancel_reason       VARCHAR(500)     NULL,
  cancelled_by        VARCHAR(32)      NULL,
  created_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_public_id       (public_id),
  UNIQUE KEY uq_bookings_idempotency_key (idempotency_key),
  CONSTRAINT chk_bookings_status         CHECK (status IN (
    'requested','offered','accepted','driver_arriving','arrived','in_progress',
    'completed','cancelled_by_rider','cancelled_by_driver','cancelled_by_company',
    'expired','no_show','disputed'
  )),
  CONSTRAINT chk_bookings_payment_method CHECK (payment_method IN ('cash','card','wallet')),
  CONSTRAINT chk_bookings_payment_status CHECK (payment_status IN ('pending','paid','refunded','failed')),
  CONSTRAINT fk_bookings_rider        FOREIGN KEY (rider_id)        REFERENCES users         (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_company      FOREIGN KEY (company_id)      REFERENCES companies     (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_driver       FOREIGN KEY (driver_id)       REFERENCES drivers       (id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_vehicle      FOREIGN KEY (vehicle_id)      REFERENCES vehicles      (id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_from_area    FOREIGN KEY (from_area_id)    REFERENCES areas         (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_to_area      FOREIGN KEY (to_area_id)      REFERENCES areas         (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_bookings_rider_id         ON bookings (rider_id);
CREATE INDEX idx_bookings_company_status   ON bookings (company_id, status);
CREATE INDEX idx_bookings_driver_id        ON bookings (driver_id);
CREATE INDEX idx_bookings_status           ON bookings (status);
CREATE INDEX idx_bookings_requested_at     ON bookings (requested_at);

-- ── booking_offers ────────────────────────────────────────────────────────────
CREATE TABLE booking_offers (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)         NOT NULL,
  booking_id   BIGINT UNSIGNED  NOT NULL,
  driver_id    BIGINT UNSIGNED  NOT NULL,
  sent_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  response     VARCHAR(20)      NULL,
  responded_at DATETIME(3)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_offers_public_id (public_id),
  UNIQUE KEY uq_booking_offers_combo     (booking_id, driver_id),
  CONSTRAINT chk_booking_offers_response CHECK (response IS NULL OR response IN ('accepted','declined','timeout')),
  CONSTRAINT fk_bo_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_bo_driver  FOREIGN KEY (driver_id)  REFERENCES drivers  (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_booking_offers_booking_id ON booking_offers (booking_id);
CREATE INDEX idx_booking_offers_driver_id  ON booking_offers (driver_id);

-- ── booking_status_history ────────────────────────────────────────────────────
CREATE TABLE booking_status_history (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  booking_id      BIGINT UNSIGNED  NOT NULL,
  from_status     VARCHAR(40)      NULL,
  to_status       VARCHAR(40)      NOT NULL,
  changed_by      BIGINT UNSIGNED  NULL,
  note            VARCHAR(500)     NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bsh_public_id (public_id),
  CONSTRAINT fk_bsh_booking    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_bsh_changed_by FOREIGN KEY (changed_by) REFERENCES users    (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_bsh_booking_id ON booking_status_history (booking_id);

-- ── booking_locations ─────────────────────────────────────────────────────────
-- Breadcrumb trail for dispute resolution. Deleted after retention period.
CREATE TABLE booking_locations (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT UNSIGNED  NOT NULL,
  lat         DECIMAL(10,7)    NOT NULL,
  lng         DECIMAL(10,7)    NOT NULL,
  recorded_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_bl_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_booking_locations_booking_id ON booking_locations (booking_id);

INSERT INTO schema_migrations (version) VALUES ('005_bookings');
