# Demo Data

Sample CSV files for running a full analysis cycle on **Instance B** (Product B alignment) in **Standard mode** (60-day inactivity threshold).

## Files

| File | Description |
|---|---|
| `usage_platform_instance_b.csv` | Usage platform export — 37 users with license metadata and activity signals |
| `hr_system_export.csv` | HR system export — 34 employee records (active + terminated + ambiguous) |

## How to Use

1. Start the app: `docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up`
2. Run migrations + seed: `npx prisma migrate deploy && npx ts-node prisma/seed.ts`
3. Log in as `admin@company.com` / `changeme123` (or `analyst@company.com` / `demo123`)
4. Upload both CSVs, select **Instance B**, **Standard** mode, **Routine** cleanup
5. Run the analysis

## Expected Results (37 users across all 9 classifications)

### Direct Remove (6)
| User | Division | Reason |
|---|---|---|
| rachel.kumar@company.com | Marketing | Inactive 115+ days, DaysActive=0, no permission sets |
| david.chen@company.com | Operations | Inactive 140+ days |
| emily.watson@company.com | Technology | Inactive 186+ days |
| marcus.jones@company.com | CEO | Inactive 191+ days |
| lisa.park@company.com | Product | Inactive 129+ days |
| nat.williams@legacy.com | Marketing | Tier 3 name match to natalie.williams@company.com, inactive 100+ days |

### Notify First (4)
| User | Division | Borderline Signal |
|---|---|---|
| james.miller@company.com | Marketing | platformDaysActive=3 |
| sarah.anderson@company.com | Operations | Permission sets populated (CHRGFYNG, skuid) |
| kevin.wright@company.com | Technology | sfDaysActive=2 |
| nina.patel@company.com | Customers/Support | platformDaysActive=1, permission sets (CaseManagement) |

### Ex-Employee (4)
| User | Reason |
|---|---|
| michael.roberts@company.com | HR shows terminated 2026-02-15, still in usage platform |
| jessica.lee@company.com | HR shows terminated 2026-01-30 |
| pat.morrison@acquired-corp.com | Legacy email, Candidate D domain-swap resolves to terminated HR record (AcquiredCorp) |
| thomas.wilson@company.com | HR shows terminated 2026-03-01 |

### GTM — Consult Required (4)
| User | GTM Path | Product |
|---|---|---|
| amanda.garcia@company.com | Sales division (Layer 1) | Product B (matches) |
| ryan.taylor@company.com | Customers/Engagement + "Customer Success Manager" (Layer 3) | Product B |
| sophia.martinez@company.com | Sales division (Layer 1) | Product B |
| daniel.brown@company.com | Customers/Professional Services + "Implementation Manager" (Layer 3) | Product B |

### Cross-Instance Anomaly (2)
| User | GTM Path | Product Mismatch |
|---|---|---|
| olivia.harris@company.com | Sales (Layer 1) | Product C (Instance B expects Product B) |
| ethan.clark@company.com | Customers/Launch Services + "Launch Manager" (Layer 3) | Product D |

### Prior Exception (2)
| User | Exception Type | Justification |
|---|---|---|
| jane.doe@company.com | keep_flag | Quarterly financial reporting access |
| alice.chen@company.com | remove_with_confirmation | Weekend coverage support |

### Human Review (3)
| User | Reason |
|---|---|
| maria.lopez@company.com | Protected department (Payments Support) |
| carlos.reyes@company.com | Discrepant activity signals (platformLastDate recent, other dates old, all DaysActive=0) |
| priya.sharma@company.com | Unknown division ("Corporate") — GTM status undetermined |

### Excluded — Active (5)
| User | Division | Note |
|---|---|---|
| bob.smith@company.com | Marketing | In prior exception register but active — exception doesn't fire |
| megan.johnson@company.com | Sales | Active 4 days ago |
| alex.rivera@company.com | Technology | Active 15 days ago |
| hannah.green@company.com | Customers/PS | GTM (Onboarding Manager), active |
| chris.nguyen@company.com | Operations | Active 10 days ago |

### Excluded — New User (2)
| User | Created | Note |
|---|---|---|
| sarah.thompson@company.com | 2026-03-25 | 15 days old, Sales/SDR |
| mike.chen@company.com | 2026-04-04 | 5 days old, Tech/Engineer |

### Excluded — Integration (3)
| User | Pattern Match |
|---|---|
| integration.sync@company.com | "integration" |
| api-user.dataload@company.com | "api-user" |
| system.automation@company.com | "system" + "automation" |

### Unresolved (2)
| User | Reason |
|---|---|
| unknown.person@external.com | No HR record match (email, name, or local-part) |
| john.smith@company.com | Ambiguous — two "John Smith" records in HR (john.a.smith, john.b.smith) |

## Notable Edge Cases Demonstrated

- **Tier 3 name match**: nat.williams@legacy.com resolves to natalie.williams@company.com via first/last name match (nameMatchFlag=true)
- **Instance suffix normalization**: ryan.taylor and daniel.brown have `.instanceb` suffixed userNames
- **Legacy email / acquisition**: pat.morrison@acquired-corp.com resolves via Candidate D domain-swap to terminated pat.morrison@company.com (AcquiredCorp)
- **Active prior exception**: bob.smith is in the exception register but active, so the exception doesn't trigger
- **Discrepant signals**: carlos.reyes has a recent platformLastActivityDate but old dates everywhere else with all DaysActive=0
- **Product alignment**: Instance B expects "Product B" — olivia.harris (Product C) and ethan.clark (Product D) trigger cross-instance anomaly
