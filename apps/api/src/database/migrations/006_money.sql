-- =============================================================================
-- Migration 006: Money
-- All amounts: BIGINT laari (1 MVR = 100 laari). No decimals ever.
-- company_ledger: UNIQUE on booking_id prevents double commission charge.
-- settlement_lines: UNIQUE on booking_id prevents a booking appearing twice.
-- =============================================================================

-- ── commission_rules ──────────────────────────────────────────────────────────
CREATE TABLE commission_rules (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)         NOT NULL,
  scope            VARCHAR(20)      NOT NULL DEFAULT 'global',
  company_id       BIGINT UNSIGNED  NULL     COMMENT 'NULL for global rule',
  percent_bps      INT UNSIGNED     NOT NULL COMMENT '10% = 1000 bps',
  fixed_fee_laari  BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  valid_from       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  valid_to         DATETIME(3)      NULL,
  created_by       BIGINT UNSIGNED  NOT NULL,
  created_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_commission_rules_public_id (public_id),
  CONSTRAINT chk_commission_rules_scope CHECK (scope IN ('global','company')),
  CONSTRAINT fk_cr_company    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cr_created_by FOREIGN KEY (created_by) REFERENCES users     (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_commission_rules_scope      ON commission_rules (scope, valid_from, valid_to);
CREATE INDEX idx_commission_rules_company_id ON commission_rules (company_id);

-- ── payments ──────────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id          CHAR(26)         NOT NULL,
  booking_id         BIGINT UNSIGNED  NOT NULL,
  method             VARCHAR(20)      NOT NULL DEFAULT 'cash',
  amount_laari       BIGINT UNSIGNED  NOT NULL,
  status             VARCHAR(20)      NOT NULL DEFAULT 'pending',
  provider_reference VARCHAR(255)     NULL,
  paid_at            DATETIME(3)      NULL,
  created_at         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_public_id (public_id),
  CONSTRAINT chk_payments_method CHECK (method IN ('cash','card','wallet')),
  CONSTRAINT chk_payments_status CHECK (status IN ('pending','paid','refunded','failed')),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_payments_booking_id ON payments (booking_id);

-- ── company_ledger ────────────────────────────────────────────────────────────
-- Tracks commission charges and top-ups. UNIQUE on (company_id, booking_id) for
-- commission_charge type prevents double charging the same booking.
CREATE TABLE company_ledger (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id           CHAR(26)         NOT NULL,
  company_id          BIGINT UNSIGNED  NOT NULL,
  type                VARCHAR(32)      NOT NULL,
  amount_laari        BIGINT           NOT NULL COMMENT 'Negative for charges',
  balance_after_laari BIGINT           NOT NULL,
  booking_id          BIGINT UNSIGNED  NULL,
  note                VARCHAR(500)     NULL,
  created_by          BIGINT UNSIGNED  NULL,
  created_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_ledger_public_id (public_id),
  -- Prevent double commission charge on same booking
  UNIQUE KEY uq_company_ledger_commission (company_id, booking_id, type),
  CONSTRAINT chk_company_ledger_type CHECK (type IN ('top_up','commission_charge','adjustment','payout')),
  CONSTRAINT fk_cl_company    FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cl_booking    FOREIGN KEY (booking_id) REFERENCES bookings  (id) ON DELETE SET NULL,
  CONSTRAINT fk_cl_created_by FOREIGN KEY (created_by) REFERENCES users     (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_company_ledger_company_id ON company_ledger (company_id, created_at);
CREATE INDEX idx_company_ledger_booking_id ON company_ledger (booking_id);

-- ── settlement_statements ─────────────────────────────────────────────────────
CREATE TABLE settlement_statements (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)         NOT NULL,
  company_id       BIGINT UNSIGNED  NOT NULL,
  period_start     DATE             NOT NULL,
  period_end       DATE             NOT NULL,
  total_rides      INT UNSIGNED     NOT NULL DEFAULT 0,
  gross_laari      BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  commission_laari BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  net_laari        BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  status           VARCHAR(20)      NOT NULL DEFAULT 'open',
  issued_at        DATETIME(3)      NULL,
  paid_at          DATETIME(3)      NULL,
  created_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_settlement_statements_public_id (public_id),
  UNIQUE KEY uq_settlement_statements_period     (company_id, period_start, period_end),
  CONSTRAINT chk_ss_status CHECK (status IN ('open','issued','paid')),
  CONSTRAINT fk_ss_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_ss_company_id ON settlement_statements (company_id, period_start);

-- ── settlement_lines ──────────────────────────────────────────────────────────
CREATE TABLE settlement_lines (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)         NOT NULL,
  statement_id     BIGINT UNSIGNED  NOT NULL,
  booking_id       BIGINT UNSIGNED  NOT NULL,
  fare_laari       BIGINT UNSIGNED  NOT NULL,
  commission_laari BIGINT UNSIGNED  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_settlement_lines_public_id  (public_id),
  UNIQUE KEY uq_settlement_lines_booking_id (booking_id) COMMENT 'One booking per settlement',
  CONSTRAINT fk_sl_statement FOREIGN KEY (statement_id) REFERENCES settlement_statements (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sl_booking   FOREIGN KEY (booking_id)   REFERENCES bookings             (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_settlement_lines_statement_id ON settlement_lines (statement_id);

-- ── refunds ───────────────────────────────────────────────────────────────────
CREATE TABLE refunds (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id     CHAR(26)         NOT NULL,
  booking_id    BIGINT UNSIGNED  NOT NULL,
  amount_laari  BIGINT UNSIGNED  NOT NULL,
  reason        VARCHAR(500)     NOT NULL,
  approved_by   BIGINT UNSIGNED  NULL,
  status        VARCHAR(20)      NOT NULL DEFAULT 'pending',
  created_by    BIGINT UNSIGNED  NULL,
  created_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_public_id (public_id),
  CONSTRAINT chk_refunds_status CHECK (status IN ('pending','approved','rejected','processed')),
  CONSTRAINT fk_refunds_booking     FOREIGN KEY (booking_id)  REFERENCES bookings (id) ON DELETE RESTRICT,
  CONSTRAINT fk_refunds_approved_by FOREIGN KEY (approved_by) REFERENCES users    (id) ON DELETE SET NULL,
  CONSTRAINT fk_refunds_created_by  FOREIGN KEY (created_by)  REFERENCES users    (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_refunds_booking_id ON refunds (booking_id);
