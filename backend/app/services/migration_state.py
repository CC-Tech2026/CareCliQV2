"""Lightweight module that tracks runtime schema migration flags.

Keeping state here (rather than in main.py) avoids the circular/brittle
pattern of services importing globals from the application entry point.
All flags are False by default (column assumed present); the startup
migration check in main.py updates them after probing the live schema.
"""

biological_sex_column_missing: bool = False
