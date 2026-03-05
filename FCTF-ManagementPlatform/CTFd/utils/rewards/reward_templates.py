"""
Reward Templates System - Simplified reward query builder for CTF organizers.

This module provides pre-built templates for common award scenarios, making it
easy for organizers to distribute rewards based on multiple criteria without
understanding complex query syntax.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class RewardCriteria:
    """Represents a single reward criterion."""
    
    id: str
    name: str
    description: str
    category: str  # "ranking", "achievement", "special"
    parameters: Dict[str, Any]
    default_params: Dict[str, Any]


@dataclass
class RewardTemplate:
    """A pre-configured reward template."""
    
    id: str
    name: str
    description: str
    category: str
    icon: str
    query_config: Dict[str, Any]
    customizable_params: List[str]
    example_usage: str


# Define all available reward templates
REWARD_TEMPLATES = {
    # ===== RANKING TEMPLATES =====
    "top_teams_by_score": RewardTemplate(
        id="top_teams_by_score",
        name="Top Teams by Score",
        description="Award the top N teams with highest scores",
        category="ranking",
        icon="trophy",
        query_config={
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_score"],
        example_usage="Award top 3 teams: limit=3"
    ),
    
    "bottom_teams_by_score": None,  # Removed
    
    "top_users_by_score": RewardTemplate(
        id="top_users_by_score",
        name="Top Users by Score",
        description="Award the top N users with highest scores",
        category="ranking",
        icon="user-check",
        query_config={
            "entity": "user",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_score", "team_id"],
        example_usage="Award top 10 users: limit=10"
    ),
    
    "teams_by_rank_range": RewardTemplate(
        id="teams_by_rank_range",
        name="Teams in Rank Range",
        description="Award teams ranked between X and Y",
        category="ranking",
        icon="medal",
        query_config={
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["min_rank", "max_rank"],
        example_usage="Award ranks 4-10: min_rank=4, max_rank=10"
    ),
    
    # ===== ACHIEVEMENT TEMPLATES =====
    "first_blood_hunters": RewardTemplate(
        id="first_blood_hunters",
        name="First Blood Hunters",
        description="Award teams/users with most first bloods",
        category="achievement",
        icon="tint",
        query_config={
            "entity": "team",
            "metric": "TEAM_FIRST_BLOOD_COUNT",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_count"],
        example_usage="Top 3 first blood hunters: limit=3, min_count=1"
    ),
    
    "category_masters": RewardTemplate(
        id="category_masters",
        name="Category Masters",
        description="Award teams/users who solved all challenges in most categories",
        category="achievement",
        icon="layer-group",
        query_config={
            "entity": "team",
            "metric": "TEAM_CATEGORY_CLEAR_COUNT",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_categories_solved"],
        example_usage="Teams clearing 3+ categories: min_categories_solved=3"
    ),
    
    "perfect_solvers": RewardTemplate(
        id="perfect_solvers",
        name="Perfect Solvers",
        description="Award teams/users with most perfect solves (no wrong submissions)",
        category="achievement",
        icon="bullseye",
        query_config={
            "entity": "team",
            "metric": "TEAM_PERFECT_SOLVE_COUNT",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_perfect_solves"],
        example_usage="Top 5 perfect solvers: limit=5, min_perfect_solves=3"
    ),
    
    "most_attempts": RewardTemplate(
        id="most_attempts",
        name="Most Persistent (Most Attempts)",
        description="Award teams/users with most wrong submissions (persistence award)",
        category="achievement",
        icon="redo",
        query_config={
            "entity": "team",
            "metric": "WRONG_SUBMISSION_COUNT",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_attempts"],
        example_usage="Top 3 most persistent: limit=3"
    ),
    
    "solve_count_champions": RewardTemplate(
        id="solve_count_champions",
        name="Solve Count Champions",
        description="Award teams/users who solved the most challenges (regardless of score)",
        category="achievement",
        icon="tasks",
        query_config={
            "entity": "team",
            "metric": "TEAM_SOLVED_COUNT",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_solves"],
        example_usage="Most challenges solved: limit=5, min_solves=10"
    ),
    
    # ===== SPECIAL CATEGORY TEMPLATES =====
    "category_specific_top": RewardTemplate(
        id="category_specific_top",
        name="Category-Specific Top Teams",
        description="Award top teams/users in a specific category (e.g., Web, Crypto)",
        category="special",
        icon="filter",
        query_config={
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "category"],
        example_usage="Top 3 in Web: limit=3, category='Web'"
    ),
    
    "first_blood_by_category": RewardTemplate(
        id="first_blood_by_category",
        name="First Blood by Category",
        description="Award first blood achievers in a specific category",
        category="special",
        icon="flag-checkered",
        query_config={
            "entity": "solve",
            "metric": "FIRST_BLOOD",
            "order": {"field": "entity_id", "direction": "asc"},
        },
        customizable_params=["category"],
        example_usage="First bloods in Forensics: category='Forensics'"
    ),
    
    "specific_challenge_solvers": RewardTemplate(
        id="specific_challenge_solvers",
        name="Specific Challenge Solvers",
        description="Award teams/users who solved specific difficult challenges",
        category="special",
        icon="star",
        query_config={
            "entity": "solve",
            "metric": "FIRST_BLOOD",
            "order": {"field": "entity_id", "direction": "asc"},
        },
        customizable_params=["challenge_id"],
        example_usage="Solved 'Ultimate Crypto': select from challenge list"
    ),
    
    "no_hints_solvers": RewardTemplate(
        id="no_hints_solvers",
        name="No Hints Solvers",
        description="Award teams/users who solved challenges without using hints",
        category="achievement",
        icon="brain",
        query_config={
            "entity": "solve",
            "metric": "FIRST_BLOOD",
            "order": {"field": "entity_id", "direction": "asc"},
        },
        customizable_params=["category", "min_solves"],
        example_usage="No hints in Crypto: category='Crypto', min_solves=3"
    ),
    
    # ===== SPEED TEMPLATES =====
    "fastest_solvers": RewardTemplate(
        id="fastest_solvers",
        name="Fastest Solvers",
        description="Award teams who completed all their solves earliest (by last submission time)",
        category="achievement",
        icon="bolt",
        query_config={
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "last_solve_date", "direction": "asc"},
        },
        customizable_params=["limit"],
        example_usage="Fastest 5 teams: limit=5"
    ),
    
    # ===== CLEAR ALL TEMPLATES =====
    "teams_clear_all_challenges": RewardTemplate(
        id="teams_clear_all_challenges",
        name="Top Teams Clear All Challenges",
        description="Teams that solved all challenges, ranked by score (like scoreboard)",
        category="ranking",
        icon="check-double",
        query_config={
            "entity": "team",
            "metric": "TEAM_TOTAL_SCORE",
            "order": {"field": "metric_value", "direction": "desc"},
        },
        customizable_params=["limit", "min_score", "category"],
        example_usage="Teams that cleared all challenges"
    ),
}


class RewardQueryBuilder:
    """Helper class to build reward queries from templates with custom parameters."""
    
    def __init__(self, template: RewardTemplate):
        self.template = template
        self.config = template.query_config.copy()
        self.filters = []
        self.limit = 50
        
    def set_limit(self, limit: int) -> 'RewardQueryBuilder':
        """Set the maximum number of results."""
        self.limit = limit
        return self
    
    def set_entity_type(self, entity_type: str) -> 'RewardQueryBuilder':
        """Set entity type (team/user/solve)."""
        if entity_type in ["team", "user", "solve"]:
            self.config["entity"] = entity_type
        return self
    
    def add_rank_filter(self, min_rank: Optional[int] = None, max_rank: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by rank range."""
        if min_rank is not None:
            self.filters.append({"field": "rank", "operator": ">=", "value": min_rank})
        if max_rank is not None:
            self.filters.append({"field": "rank", "operator": "<=", "value": max_rank})
        return self
    
    def add_score_filter(self, min_score: Optional[int] = None, max_score: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by score range."""
        if min_score is not None:
            self.filters.append({"field": "total_score", "operator": ">=", "value": min_score})
        if max_score is not None:
            self.filters.append({"field": "total_score", "operator": "<=", "value": max_score})
        return self
    
    def add_category_filter(self, categories: List[str]) -> 'RewardQueryBuilder':
        """Filter by challenge categories."""
        if len(categories) == 1:
            self.filters.append({"field": "category", "operator": "=", "value": categories[0]})
        elif len(categories) > 1:
            self.filters.append({"field": "category", "operator": "IN", "value": categories})
        return self
    
    def add_solve_count_filter(self, min_solves: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by minimum solve count."""
        if min_solves is not None:
            self.filters.append({"field": "solved_count", "operator": ">=", "value": min_solves})
        return self
    
    def add_wrong_count_filter(self, min_wrong: Optional[int] = None, max_wrong: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by wrong submission count."""
        if min_wrong is not None:
            self.filters.append({"field": "wrong_count", "operator": ">=", "value": min_wrong})
        if max_wrong is not None:
            self.filters.append({"field": "wrong_count", "operator": "<=", "value": max_wrong})
        return self
    
    def add_perfect_solve_filter(self, min_perfect: int) -> 'RewardQueryBuilder':
        """Filter by minimum perfect solves (zero wrong submissions)."""
        if min_perfect > 0:
            # This is tracked via metric, but can also filter
            self.filters.append({"field": "solved_count", "operator": ">=", "value": min_perfect})
        return self
    
    def add_first_blood_filter(self, only_first_blood: bool = True) -> 'RewardQueryBuilder':
        """Filter to only first blood solves."""
        if only_first_blood:
            self.filters.append({"field": "first_blood", "operator": "=", "value": True})
        return self
    
    def add_no_hints_filter(self) -> 'RewardQueryBuilder':
        """Filter to only solves without hints."""
        self.filters.append({"field": "hint_used", "operator": "=", "value": False})
        return self
    
    def add_first_blood_count_filter(self, min_count: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by minimum first blood count."""
        if min_count is not None:
            self.filters.append({"field": "first_blood_count", "operator": ">=", "value": min_count})
        return self
    
    def add_category_clear_count_filter(self, min_categories: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by minimum categories cleared."""
        if min_categories is not None:
            self.filters.append({"field": "category_clear_count", "operator": ">=", "value": min_categories})
        return self
    
    def add_team_filter(self, team_id: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by team ID."""
        if team_id is not None:
            self.filters.append({"field": "team_id", "operator": "=", "value": team_id})
        return self
    
    def add_challenge_filter(self, challenge_id) -> 'RewardQueryBuilder':
        """Filter by challenge ID."""
        if challenge_id is not None:
            if isinstance(challenge_id, list):
                self.filters.append({"field": "challenge_id", "operator": "IN", "value": challenge_id})
            else:
                self.filters.append({"field": "challenge_id", "operator": "=", "value": challenge_id})
        return self
        return self
    
    def add_time_filter(self, max_time: Optional[int] = None) -> 'RewardQueryBuilder':
        """Filter by maximum solve time (in seconds)."""
        if max_time is not None:
            self.filters.append({"field": "solve_time", "operator": "<=", "value": max_time})
        return self
    
    def build(self) -> Dict[str, Any]:
        """Build the final query configuration."""
        return {
            "rule": self.template.id,
            "entity": self.config["entity"],
            "metric": self.config["metric"],
            "filters": self.filters,
            "limit": self.limit,
            "order": self.config.get("order", {}),
        }


def get_template(template_id: str) -> Optional[RewardTemplate]:
    """Get a reward template by ID."""
    return REWARD_TEMPLATES.get(template_id)


def list_templates(category: Optional[str] = None) -> List[RewardTemplate]:
    """List all available templates, optionally filtered by category."""
    templates = [t for t in REWARD_TEMPLATES.values() if t is not None]
    if category:
        templates = [t for t in templates if t.category == category]
    return templates


def get_template_categories() -> List[str]:
    """Get all unique template categories."""
    return sorted(set(t.category for t in REWARD_TEMPLATES.values() if t is not None))


def build_query_from_template(template_id: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Build a query from a template with custom parameters.
    
    Args:
        template_id: The template ID
        params: Custom parameters for the template
            - limit: Maximum number of results (default: 50)
            - entity_type: team/user/solve (overrides template default if applicable)
            - min_rank, max_rank: Rank range filters
            - min_score, max_score: Score range filters
            - categories: List of category names
            - min_solves: Minimum solve count
            - min_perfect_solves: Minimum perfect solves
            - min_attempts: Minimum wrong submission count
            - category: Single category name
            - only_first_blood: Boolean for first blood filter
            - no_hints: Boolean for no hints filter
            - max_solve_time: Maximum solve time in seconds
    
    Returns:
        Query configuration dict ready for execute_query(), or None if template not found
    """
    template = get_template(template_id)
    if not template:
        return None
    
    builder = RewardQueryBuilder(template)
    
    # Apply common parameters
    if "limit" in params:
        builder.set_limit(params["limit"])
    
    if "entity_type" in params:
        builder.set_entity_type(params["entity_type"])
    
    # Apply rank filters
    if "min_rank" in params or "max_rank" in params:
        builder.add_rank_filter(
            min_rank=params.get("min_rank"),
            max_rank=params.get("max_rank")
        )
    
    # Apply score filters
    if "min_score" in params or "max_score" in params:
        builder.add_score_filter(
            min_score=params.get("min_score"),
            max_score=params.get("max_score")
        )
    
    # Apply category filter
    if "categories" in params:
        builder.add_category_filter(params["categories"])
    elif "category" in params:
        builder.add_category_filter([params["category"]])
    
    # Apply solve count filter
    if "min_solves" in params:
        builder.add_solve_count_filter(params["min_solves"])
    
    # Apply wrong count filter
    if "min_attempts" in params or "max_attempts" in params:
        builder.add_wrong_count_filter(
            min_wrong=params.get("min_attempts"),
            max_wrong=params.get("max_attempts")
        )
    
    # Apply perfect solve filter
    if "min_perfect_solves" in params:
        builder.add_perfect_solve_filter(params["min_perfect_solves"])
    
    # Apply first blood filter
    if params.get("only_first_blood"):
        builder.add_first_blood_filter()
    
    # Apply no hints filter
    if params.get("no_hints"):
        builder.add_no_hints_filter()
    
    # Apply time filter
    if "max_solve_time" in params:
        builder.add_time_filter(params["max_solve_time"])
    
    # Apply first blood count filter
    if "min_count" in params:
        builder.add_first_blood_count_filter(params["min_count"])
    
    # Apply category clear count filter
    if "min_categories_solved" in params:
        builder.add_category_clear_count_filter(params["min_categories_solved"])
    
    # Apply team filter
    if "team_id" in params:
        builder.add_team_filter(params["team_id"])
    
    # Apply challenge filter
    if "challenge_id" in params:
        builder.add_challenge_filter(params["challenge_id"])
    
    # Special handling for teams_clear_all_challenges
    if template_id == "teams_clear_all_challenges":
        from CTFd.models import Challenges
        cat = params.get("category")
        q = Challenges.query
        if cat:
            q = q.filter_by(category=cat)
        total = q.count()
        builder.add_solve_count_filter(min_solves=total)
    
    return builder.build()
