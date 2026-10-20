"""Football research platform - offline modelling pipeline.

Heavy modelling runs here (offline/batch), never inside a Worker HTTP request.
Outputs are versioned JSON artifacts imported into D1 by an authenticated admin path.
"""

PIPELINE_VERSION = "pipeline-0.1.0"
GOALS_MODEL_VERSION = "goals-dc-v0.2"
FIRST_HALF_MODEL_VERSION = "fh-poisson-v0.1"
CORNERS_MODEL_VERSION = "corners-nb-v0.1"
CARDS_MODEL_VERSION = "cards-nb-v0.1"
MODEL_VERSION = "fip-v0.2"
