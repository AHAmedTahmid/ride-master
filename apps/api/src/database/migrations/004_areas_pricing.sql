-- =============================================================================
-- Migration 004: Areas and Pricing
-- Areas use GEOMETRY (SRID 0, planar) with a SPATIAL INDEX.
-- Coordinate order: (longitude, latitude) — consistent throughout.
-- =============================================================================

USE ride_master;

-- ── areas ─────────────────────────────────────────────────────────────────────
CREATE TABLE areas (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id  CHAR(26)         NOT NULL,
  name_en    VARCHAR(200)     NOT NULL,
  name_dv    VARCHAR(200)     NOT NULL,
  type       VARCHAR(50)      NOT NULL DEFAULT 'zone',
  geometry   GEOMETRY         NOT NULL SRID 0 COMMENT 'POLYGON, (lng lat) coordinates',
  active     TINYINT(1)       NOT NULL DEFAULT 1,
  is_demo    TINYINT(1)       NOT NULL DEFAULT 0,
  created_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_areas_public_id (public_id),
  SPATIAL INDEX sidx_areas_geometry (geometry)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Add FK from company_service_areas now that areas exists
ALTER TABLE company_service_areas
  ADD CONSTRAINT fk_csa_area FOREIGN KEY (area_id) REFERENCES areas (id) ON DELETE RESTRICT;

-- ── suggested_fares ───────────────────────────────────────────────────────────
-- Set by SuperAdmin; new operators can accept in one tap.
CREATE TABLE suggested_fares (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  from_area_id    BIGINT UNSIGNED  NOT NULL,
  to_area_id      BIGINT UNSIGNED  NOT NULL,
  vehicle_type_id BIGINT UNSIGNED  NOT NULL,
  price_laari     BIGINT UNSIGNED  NOT NULL,
  created_by      BIGINT UNSIGNED  NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_suggested_fares_public_id   (public_id),
  UNIQUE KEY uq_suggested_fares_route       (from_area_id, to_area_id, vehicle_type_id),
  CONSTRAINT fk_sf_from_area FOREIGN KEY (from_area_id)    REFERENCES areas         (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sf_to_area   FOREIGN KEY (to_area_id)      REFERENCES areas         (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sf_vtype     FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── fares ─────────────────────────────────────────────────────────────────────
CREATE TABLE fares (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  company_id      BIGINT UNSIGNED  NOT NULL,
  vehicle_type_id BIGINT UNSIGNED  NOT NULL,
  from_area_id    BIGINT UNSIGNED  NOT NULL,
  to_area_id      BIGINT UNSIGNED  NOT NULL,
  price_laari     BIGINT UNSIGNED  NOT NULL,
  active          TINYINT(1)       NOT NULL DEFAULT 1,
  valid_from      DATETIME(3)      NULL,
  valid_to        DATETIME(3)      NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fares_public_id (public_id),
  -- One active fare per company + route + vehicle type
  UNIQUE KEY uq_fares_route (company_id, from_area_id, to_area_id, vehicle_type_id),
  CONSTRAINT fk_fares_company  FOREIGN KEY (company_id)      REFERENCES companies     (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fares_vtype    FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fares_from     FOREIGN KEY (from_area_id)    REFERENCES areas         (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fares_to       FOREIGN KEY (to_area_id)      REFERENCES areas         (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_fares_company_id ON fares (company_id);
CREATE INDEX idx_fares_route      ON fares (from_area_id, to_area_id, vehicle_type_id, active);

-- ── surcharges ────────────────────────────────────────────────────────────────
CREATE TABLE surcharges (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)         NOT NULL,
  company_id   BIGINT UNSIGNED  NOT NULL,
  name         VARCHAR(100)     NOT NULL,
  amount_laari BIGINT           NULL COMMENT 'Fixed amount in laari (use this OR percent_bps)',
  percent_bps  INT              NULL COMMENT 'Percentage in basis points',
  time_from    TIME             NULL COMMENT 'Start of surcharge window (UTC)',
  time_to      TIME             NULL COMMENT 'End of surcharge window (UTC)',
  active       TINYINT(1)       NOT NULL DEFAULT 1,
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_surcharges_public_id (public_id),
  CONSTRAINT fk_surcharges_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_surcharges_company_id ON surcharges (company_id);

-- ── fare_history ──────────────────────────────────────────────────────────────
CREATE TABLE fare_history (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  fare_id         BIGINT UNSIGNED  NOT NULL,
  old_price_laari BIGINT UNSIGNED  NOT NULL,
  new_price_laari BIGINT UNSIGNED  NOT NULL,
  changed_by      BIGINT UNSIGNED  NOT NULL,
  changed_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fare_history_public_id (public_id),
  CONSTRAINT fk_fh_fare       FOREIGN KEY (fare_id)    REFERENCES fares (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fh_changed_by FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_fare_history_fare_id ON fare_history (fare_id);

INSERT INTO schema_migrations (version) VALUES ('004_areas_pricing');
