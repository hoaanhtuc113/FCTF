"""
Multi-Criteria Reward System

Allows combining multiple reward criteria using AND/OR logic for more sophisticated
reward distribution scenarios.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from CTFd.utils.rewards.query_engine import execute_query, validate_query_spec
from CTFd.utils.rewards.reward_templates import build_query_from_template


@dataclass
class CriteriaRule:
    """A single criteria rule in a multi-criteria query."""
    
    template_id: str
    params: Dict[str, Any]
    weight: float = 1.0  # Weight for scoring (if combining scores)


@dataclass
class MultiCriteriaQuery:
    """Represents a multi-criteria reward query."""
    
    rules: List[CriteriaRule]
    logic: str  # "AND" or "OR"
    combine_method: str  # "intersection", "union", "weighted_score"
    description: str


class MultiCriteriaExecutor:
    """Execute multi-criteria reward queries."""
    
    def __init__(self, query: MultiCriteriaQuery):
        self.query = query
        self.rule_results = []
    
    def execute(self) -> Dict[str, Any]:
        """Execute all criteria and combine results."""
        # Execute each rule
        for rule in self.query.rules:
            query_config = build_query_from_template(rule.template_id, rule.params)
            if not query_config:
                raise ValueError(f"Template {rule.template_id} not found")
            
            spec = validate_query_spec(query_config)
            result = execute_query(spec)
            self.rule_results.append({
                "rule": rule,
                "result": result
            })
        
        # Combine results based on logic
        if self.query.combine_method == "intersection":
            return self._combine_intersection()
        elif self.query.combine_method == "union":
            return self._combine_union()
        elif self.query.combine_method == "weighted_score":
            return self._combine_weighted_score()
        else:
            raise ValueError(f"Unknown combine method: {self.query.combine_method}")
    
    def _combine_intersection(self) -> Dict[str, Any]:
        """Combine results using intersection (AND logic)."""
        if not self.rule_results:
            return {"result": [], "description": "No rules executed"}
        
        # Start with first result set
        entity_sets = []
        for rule_result in self.rule_results:
            entity_ids = {r["entity_id"] for r in rule_result["result"]["result"]}
            entity_sets.append(entity_ids)
        
        # Find intersection
        common_entities = set.intersection(*entity_sets) if entity_sets else set()
        
        # Build result from first rule's data
        first_result = self.rule_results[0]["result"]["result"]
        combined = [r for r in first_result if r["entity_id"] in common_entities]
        
        return {
            "result": combined,
            "description": f"Entities matching ALL {len(self.query.rules)} criteria",
            "logic": "AND",
            "total_matched": len(combined),
            "rule_details": [
                {
                    "template": rr["rule"].template_id,
                    "matched": len(rr["result"]["result"])
                }
                for rr in self.rule_results
            ]
        }
    
    def _combine_union(self) -> Dict[str, Any]:
        """Combine results using union (OR logic)."""
        if not self.rule_results:
            return {"result": [], "description": "No rules executed"}
        
        # Collect all unique entities
        seen_entities = {}
        for rule_result in self.rule_results:
            for row in rule_result["result"]["result"]:
                entity_id = row["entity_id"]
                if entity_id not in seen_entities:
                    seen_entities[entity_id] = row
        
        combined = list(seen_entities.values())
        
        return {
            "result": combined,
            "description": f"Entities matching ANY of {len(self.query.rules)} criteria",
            "logic": "OR",
            "total_matched": len(combined),
            "rule_details": [
                {
                    "template": rr["rule"].template_id,
                    "matched": len(rr["result"]["result"])
                }
                for rr in self.rule_results
            ]
        }
    
    def _combine_weighted_score(self) -> Dict[str, Any]:
        """Combine results using weighted scoring."""
        if not self.rule_results:
            return {"result": [], "description": "No rules executed"}
        
        # Calculate weighted scores for each entity
        entity_scores = {}
        entity_data = {}
        
        for rule_result in self.rule_results:
            weight = rule_result["rule"].weight
            for row in rule_result["result"]["result"]:
                entity_id = row["entity_id"]
                metric_value = row.get("metric_value", 0) or 0
                
                if entity_id not in entity_scores:
                    entity_scores[entity_id] = 0
                    entity_data[entity_id] = row
                
                entity_scores[entity_id] += metric_value * weight
        
        # Build result with combined scores
        combined = []
        for entity_id, score in entity_scores.items():
            row = entity_data[entity_id].copy()
            row["combined_score"] = score
            row["metric_value"] = score  # Replace metric with combined score
            combined.append(row)
        
        # Sort by combined score
        combined.sort(key=lambda x: x["combined_score"], reverse=True)
        
        return {
            "result": combined,
            "description": f"Entities scored by weighted combination of {len(self.query.rules)} criteria",
            "logic": "WEIGHTED",
            "total_matched": len(combined),
            "rule_details": [
                {
                    "template": rr["rule"].template_id,
                    "weight": rr["rule"].weight,
                    "matched": len(rr["result"]["result"])
                }
                for rr in self.rule_results
            ]
        }


def create_multi_criteria_query(
    rules: List[Dict[str, Any]],
    logic: str = "AND",
    combine_method: str = "intersection",
    description: str = ""
) -> MultiCriteriaQuery:
    """
    Create a multi-criteria query from configuration.
    
    Args:
        rules: List of rule configs, each with:
            - template_id: Template ID
            - params: Parameters for the template
            - weight: (optional) Weight for weighted scoring
        logic: "AND" or "OR"
        combine_method: "intersection", "union", or "weighted_score"
        description: Human-readable description
    
    Returns:
        MultiCriteriaQuery object
    """
    criteria_rules = [
        CriteriaRule(
            template_id=r["template_id"],
            params=r.get("params", {}),
            weight=r.get("weight", 1.0)
        )
        for r in rules
    ]
    
    return MultiCriteriaQuery(
        rules=criteria_rules,
        logic=logic,
        combine_method=combine_method,
        description=description or f"Multi-criteria query with {len(rules)} rules"
    )


# Preset multi-criteria scenarios
MULTI_CRITERIA_PRESETS = {
    "elite_performers": {
        "description": "Elite performers: Top scorers who also have multiple first bloods",
        "rules": [
            {
                "template_id": "top_teams_by_score",
                "params": {"limit": 20}
            },
            {
                "template_id": "first_blood_hunters",
                "params": {"min_count": 3}
            }
        ],
        "logic": "AND",
        "combine_method": "intersection"
    },
    
    "category_specialists": {
        "description": "Teams mastering specific categories with perfect solves",
        "rules": [
            {
                "template_id": "category_masters",
                "params": {"min_categories": 2}
            },
            {
                "template_id": "perfect_solvers",
                "params": {"min_perfect_solves": 5}
            }
        ],
        "logic": "AND",
        "combine_method": "intersection"
    },
    
    "high_performers_any": {
        "description": "High performers: Top scorers OR most solves OR most first bloods",
        "rules": [
            {
                "template_id": "top_teams_by_score",
                "params": {"limit": 10}
            },
            {
                "template_id": "solve_count_champions",
                "params": {"limit": 10}
            },
            {
                "template_id": "first_blood_hunters",
                "params": {"limit": 10}
            }
        ],
        "logic": "OR",
        "combine_method": "union"
    },
    
    "overall_excellence": {
        "description": "Overall excellence score: Weighted combination of score, solves, and first bloods",
        "rules": [
            {
                "template_id": "top_teams_by_score",
                "params": {"limit": 100},
                "weight": 0.5
            },
            {
                "template_id": "solve_count_champions",
                "params": {"limit": 100},
                "weight": 0.3
            },
            {
                "template_id": "first_blood_hunters",
                "params": {"limit": 100},
                "weight": 0.2
            }
        ],
        "logic": "WEIGHTED",
        "combine_method": "weighted_score"
    }
}


def get_multi_criteria_preset(preset_id: str) -> Optional[MultiCriteriaQuery]:
    """Get a preset multi-criteria query."""
    preset = MULTI_CRITERIA_PRESETS.get(preset_id)
    if not preset:
        return None
    
    return create_multi_criteria_query(
        rules=preset["rules"],
        logic=preset["logic"],
        combine_method=preset["combine_method"],
        description=preset["description"]
    )


def list_multi_criteria_presets() -> List[Dict[str, str]]:
    """List all available multi-criteria presets."""
    return [
        {
            "id": preset_id,
            "description": preset["description"],
            "logic": preset["logic"],
            "rule_count": len(preset["rules"])
        }
        for preset_id, preset in MULTI_CRITERIA_PRESETS.items()
    ]
