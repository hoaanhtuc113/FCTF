"""
Examples of using the Reward Templates system programmatically.

These examples show how to use the reward system from Python code,
useful for automation, testing, or custom integrations.
"""

from CTFd.utils.rewards.reward_templates import (
    build_query_from_template,
    get_template,
    list_templates,
    RewardQueryBuilder,
)
from CTFd.utils.rewards.query_engine import execute_query, validate_query_spec
from CTFd.utils.rewards.multi_criteria import (
    create_multi_criteria_query,
    MultiCriteriaExecutor,
    get_multi_criteria_preset,
)


# ============================================================================
# Example 1: Simple template usage - Top 10 teams
# ============================================================================

def example_top_10_teams():
    """Award top 10 teams by score."""
    query_config = build_query_from_template(
        template_id="top_teams_by_score",
        params={"limit": 10}
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"Found {len(result['result'])} teams")
    for idx, team in enumerate(result['result'], 1):
        print(f"{idx}. {team['entity_name']} - Score: {team['metric_value']}")
    
    return result


# ============================================================================
# Example 2: Category-specific rewards - Top Web players
# ============================================================================

def example_category_specific():
    """Award top performers in Web category."""
    query_config = build_query_from_template(
        template_id="category_specific_top",
        params={
            "limit": 5,
            "category": "Web",
            "entity_type": "user"  # Can be "team" or "user"
        }
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"Top Web category performers:")
    for user in result['result']:
        print(f"- {user['entity_name']}: {user['metric_value']} points")
    
    return result


# ============================================================================
# Example 3: Using QueryBuilder for custom filtering
# ============================================================================

def example_custom_builder():
    """Create a custom query using the builder pattern."""
    template = get_template("top_teams_by_score")
    
    builder = RewardQueryBuilder(template)
    query_config = (
        builder
        .set_limit(20)
        .add_rank_filter(min_rank=5, max_rank=15)  # Ranks 5-15 only
        .add_score_filter(min_score=500)  # Minimum 500 points
        .add_solve_count_filter(min_solves=5)  # At least 5 solves
        .build()
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"Teams ranked 5-15 with 500+ points and 5+ solves:")
    for team in result['result']:
        print(f"- {team['entity_name']}: {team['metric_value']}")
    
    return result


# ============================================================================
# Example 4: First Blood hunters
# ============================================================================

def example_first_blood_hunters():
    """Find teams with most first bloods."""
    query_config = build_query_from_template(
        template_id="first_blood_hunters",
        params={
            "limit": 5,
            "min_count": 2,  # At least 2 first bloods
            "entity_type": "team"
        }
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"Top First Blood Hunters:")
    for team in result['result']:
        print(f"- {team['entity_name']}: {team['metric_value']} first bloods")
    
    return result


# ============================================================================
# Example 5: Perfect solvers (no wrong submissions)
# ============================================================================

def example_perfect_solvers():
    """Find teams/users with most perfect solves."""
    query_config = build_query_from_template(
        template_id="perfect_solvers",
        params={
            "limit": 10,
            "min_perfect_solves": 3,
            "entity_type": "team"
        }
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"Teams with 3+ perfect solves:")
    for team in result['result']:
        print(f"- {team['entity_name']}: {team['metric_value']} perfect solves")
    
    return result


# ============================================================================
# Example 6: Multi-criteria - Elite performers (intersection)
# ============================================================================

def example_multi_criteria_intersection():
    """
    Find teams that are BOTH:
    - In top 20 by score
    - Have at least 3 first bloods
    """
    query = create_multi_criteria_query(
        rules=[
            {
                "template_id": "top_teams_by_score",
                "params": {"limit": 20}
            },
            {
                "template_id": "first_blood_hunters",
                "params": {"min_count": 3}
            }
        ],
        logic="AND",
        combine_method="intersection",
        description="Elite performers: Top scorers with multiple first bloods"
    )
    
    executor = MultiCriteriaExecutor(query)
    result = executor.execute()
    
    print(f"\nElite Performers (intersection of criteria):")
    print(f"Description: {result['description']}")
    print(f"Total matched: {result['total_matched']}")
    print(f"\nRule details:")
    for rule_detail in result['rule_details']:
        print(f"  - {rule_detail['template']}: {rule_detail['matched']} matches")
    
    print(f"\nFinal results:")
    for team in result['result']:
        print(f"- {team['entity_name']}: {team['metric_value']}")
    
    return result


# ============================================================================
# Example 7: Multi-criteria - High performers (union)
# ============================================================================

def example_multi_criteria_union():
    """
    Find teams that meet ANY of these criteria:
    - Top 10 by score
    - Top 10 by solve count
    - Top 10 by first blood count
    """
    query = create_multi_criteria_query(
        rules=[
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
        logic="OR",
        combine_method="union",
        description="High performers in any category"
    )
    
    executor = MultiCriteriaExecutor(query)
    result = executor.execute()
    
    print(f"\nHigh Performers (union of criteria):")
    print(f"Total unique teams: {result['total_matched']}")
    
    for team in result['result']:
        print(f"- {team['entity_name']}")
    
    return result


# ============================================================================
# Example 8: Multi-criteria - Weighted score
# ============================================================================

def example_multi_criteria_weighted():
    """
    Calculate overall excellence score based on:
    - Score (50% weight)
    - Solve count (30% weight)
    - First blood count (20% weight)
    """
    query = create_multi_criteria_query(
        rules=[
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
        logic="WEIGHTED",
        combine_method="weighted_score",
        description="Overall excellence score"
    )
    
    executor = MultiCriteriaExecutor(query)
    result = executor.execute()
    
    print(f"\nOverall Excellence Ranking:")
    for idx, team in enumerate(result['result'][:10], 1):
        print(f"{idx}. {team['entity_name']}: {team['combined_score']:.2f}")
    
    return result


# ============================================================================
# Example 9: Using preset multi-criteria
# ============================================================================

def example_preset_multi_criteria():
    """Use a predefined multi-criteria preset."""
    query = get_multi_criteria_preset("elite_performers")
    
    executor = MultiCriteriaExecutor(query)
    result = executor.execute()
    
    print(f"\nUsing preset: elite_performers")
    print(f"Description: {query.description}")
    print(f"Matched: {result['total_matched']} teams")
    
    for team in result['result']:
        print(f"- {team['entity_name']}")
    
    return result


# ============================================================================
# Example 10: Category specialists
# ============================================================================

def example_category_specialists():
    """
    Find teams that are BOTH:
    - Cleared at least 2 categories
    - Have at least 5 perfect solves
    """
    query = create_multi_criteria_query(
        rules=[
            {
                "template_id": "category_masters",
                "params": {"min_categories": 2}
            },
            {
                "template_id": "perfect_solvers",
                "params": {"min_perfect_solves": 5}
            }
        ],
        logic="AND",
        combine_method="intersection",
        description="Category specialists with perfect solves"
    )
    
    executor = MultiCriteriaExecutor(query)
    result = executor.execute()
    
    print(f"\nCategory Specialists:")
    print(f"Found {result['total_matched']} teams")
    
    for team in result['result']:
        print(f"- {team['entity_name']}")
    
    return result


# ============================================================================
# Example 11: List all available templates
# ============================================================================

def example_list_templates():
    """List all available reward templates."""
    templates = list_templates()
    
    print("\nAvailable Reward Templates:")
    print("=" * 80)
    
    by_category = {}
    for template in templates:
        if template.category not in by_category:
            by_category[template.category] = []
        by_category[template.category].append(template)
    
    for category, templates_list in sorted(by_category.items()):
        print(f"\n{category.upper()}:")
        for t in templates_list:
            print(f"  - {t.id}")
            print(f"    Name: {t.name}")
            print(f"    Description: {t.description}")
            print(f"    Params: {', '.join(t.customizable_params)}")
            print()


# ============================================================================
# Example 12: Complex filtering with builder
# ============================================================================

def example_complex_filtering():
    """
    Complex example: Teams in Web category that:
    - Solved at least 3 challenges
    - Have score >= 300
    - Solved within first 2 hours (7200 seconds)
    """
    template = get_template("category_specific_top")
    
    builder = RewardQueryBuilder(template)
    query_config = (
        builder
        .set_limit(10)
        .add_category_filter(["Web"])
        .add_solve_count_filter(min_solves=3)
        .add_score_filter(min_score=300)
        .add_time_filter(max_time=7200)
        .build()
    )
    
    spec = validate_query_spec(query_config)
    result = execute_query(spec)
    
    print(f"\nWeb category speedrunners (3+ solves, 300+ points, <2h):")
    for team in result['result']:
        print(f"- {team['entity_name']}: {team['metric_value']}")
    
    return result


# ============================================================================
# Main - Run all examples
# ============================================================================

if __name__ == "__main__":
    print("=" * 80)
    print("REWARD TEMPLATES SYSTEM - EXAMPLES")
    print("=" * 80)
    
    try:
        print("\n\n--- Example 1: Top 10 Teams ---")
        example_top_10_teams()
        
        print("\n\n--- Example 2: Category Specific (Web) ---")
        example_category_specific()
        
        print("\n\n--- Example 3: Custom Builder ---")
        example_custom_builder()
        
        print("\n\n--- Example 4: First Blood Hunters ---")
        example_first_blood_hunters()
        
        print("\n\n--- Example 5: Perfect Solvers ---")
        example_perfect_solvers()
        
        print("\n\n--- Example 6: Multi-Criteria (Intersection) ---")
        example_multi_criteria_intersection()
        
        print("\n\n--- Example 7: Multi-Criteria (Union) ---")
        example_multi_criteria_union()
        
        print("\n\n--- Example 8: Multi-Criteria (Weighted) ---")
        example_multi_criteria_weighted()
        
        print("\n\n--- Example 9: Preset Multi-Criteria ---")
        example_preset_multi_criteria()
        
        print("\n\n--- Example 10: Category Specialists ---")
        example_category_specialists()
        
        print("\n\n--- Example 11: List All Templates ---")
        example_list_templates()
        
        print("\n\n--- Example 12: Complex Filtering ---")
        example_complex_filtering()
        
    except Exception as e:
        print(f"\nError running examples: {e}")
        print("Make sure you have an active CTFd database connection.")
