"""
Unit tests for the Reward Templates system.

Run with: pytest test_reward_templates.py
"""

import pytest
from CTFd.utils.rewards.reward_templates import (
    RewardQueryBuilder,
    RewardTemplate,
    build_query_from_template,
    get_template,
    get_template_categories,
    list_templates,
)
from CTFd.utils.rewards.multi_criteria import (
    create_multi_criteria_query,
    get_multi_criteria_preset,
    list_multi_criteria_presets,
    MultiCriteriaExecutor,
)


class TestRewardTemplates:
    """Test reward template functionality."""
    
    def test_list_templates(self):
        """Test listing all templates."""
        templates = list_templates()
        assert len(templates) > 0
        assert all(isinstance(t, RewardTemplate) for t in templates)
    
    def test_list_templates_by_category(self):
        """Test filtering templates by category."""
        ranking_templates = list_templates(category="ranking")
        assert len(ranking_templates) > 0
        assert all(t.category == "ranking" for t in ranking_templates)
        
        achievement_templates = list_templates(category="achievement")
        assert len(achievement_templates) > 0
        assert all(t.category == "achievement" for t in achievement_templates)
    
    def test_get_template(self):
        """Test getting a specific template."""
        template = get_template("top_teams_by_score")
        assert template is not None
        assert template.id == "top_teams_by_score"
        assert template.name == "Top Teams by Score"
        assert template.category == "ranking"
        
        # Non-existent template
        assert get_template("nonexistent") is None
    
    def test_get_template_categories(self):
        """Test getting all categories."""
        categories = get_template_categories()
        assert len(categories) > 0
        assert "ranking" in categories
        assert "achievement" in categories
        assert "special" in categories
    
    def test_build_query_from_template_basic(self):
        """Test building a query from template with basic params."""
        query = build_query_from_template(
            "top_teams_by_score",
            {"limit": 10}
        )
        
        assert query is not None
        assert query["entity"] == "team"
        assert query["metric"] == "TEAM_TOTAL_SCORE"
        assert query["limit"] == 10
        assert query["rule"] == "top_teams_by_score"
    
    def test_build_query_with_filters(self):
        """Test building query with various filters."""
        query = build_query_from_template(
            "top_teams_by_score",
            {
                "limit": 20,
                "min_rank": 5,
                "max_rank": 15,
                "min_score": 500
            }
        )
        
        assert query["limit"] == 20
        assert len(query["filters"]) > 0
        
        # Check rank filters
        rank_filters = [f for f in query["filters"] if f["field"] == "rank"]
        assert len(rank_filters) == 2
    
    def test_build_query_with_category(self):
        """Test building query with category filter."""
        query = build_query_from_template(
            "category_specific_top",
            {
                "limit": 5,
                "category": "Web"
            }
        )
        
        assert query is not None
        category_filters = [f for f in query["filters"] if f["field"] == "category"]
        assert len(category_filters) == 1
        assert category_filters[0]["value"] == "Web"
    
    def test_build_query_with_multiple_categories(self):
        """Test building query with multiple categories."""
        query = build_query_from_template(
            "category_specific_top",
            {
                "categories": ["Web", "Crypto", "Pwn"]
            }
        )
        
        assert query is not None
        category_filters = [f for f in query["filters"] if f["field"] == "category"]
        assert len(category_filters) == 1
        assert category_filters[0]["operator"] == "IN"
        assert len(category_filters[0]["value"]) == 3
    
    def test_build_query_nonexistent_template(self):
        """Test building query with non-existent template."""
        query = build_query_from_template("nonexistent", {})
        assert query is None


class TestRewardQueryBuilder:
    """Test RewardQueryBuilder functionality."""
    
    def test_builder_basic(self):
        """Test basic builder usage."""
        template = get_template("top_teams_by_score")
        builder = RewardQueryBuilder(template)
        
        query = builder.set_limit(25).build()
        
        assert query["limit"] == 25
        assert query["entity"] == "team"
        assert query["metric"] == "TEAM_TOTAL_SCORE"
    
    def test_builder_chaining(self):
        """Test method chaining."""
        template = get_template("top_teams_by_score")
        
        query = (
            RewardQueryBuilder(template)
            .set_limit(50)
            .add_rank_filter(min_rank=10, max_rank=20)
            .add_score_filter(min_score=1000)
            .build()
        )
        
        assert query["limit"] == 50
        assert len(query["filters"]) == 3  # 2 rank + 1 score
    
    def test_builder_entity_type(self):
        """Test changing entity type."""
        template = get_template("top_teams_by_score")
        
        query = (
            RewardQueryBuilder(template)
            .set_entity_type("user")
            .build()
        )
        
        assert query["entity"] == "user"
    
    def test_builder_category_filter(self):
        """Test adding category filter."""
        template = get_template("category_specific_top")
        
        query = (
            RewardQueryBuilder(template)
            .add_category_filter(["Web", "Crypto"])
            .build()
        )
        
        filters = [f for f in query["filters"] if f["field"] == "category"]
        assert len(filters) == 1
        assert filters[0]["operator"] == "IN"
    
    def test_builder_first_blood_filter(self):
        """Test adding first blood filter."""
        template = get_template("first_blood_by_category")
        
        query = (
            RewardQueryBuilder(template)
            .add_first_blood_filter(True)
            .build()
        )
        
        fb_filters = [f for f in query["filters"] if f["field"] == "first_blood"]
        assert len(fb_filters) == 1
        assert fb_filters[0]["value"] is True
    
    def test_builder_no_hints_filter(self):
        """Test adding no hints filter."""
        template = get_template("no_hints_solvers")
        
        query = (
            RewardQueryBuilder(template)
            .add_no_hints_filter()
            .build()
        )
        
        hint_filters = [f for f in query["filters"] if f["field"] == "hint_used"]
        assert len(hint_filters) == 1
        assert hint_filters[0]["value"] is False


class TestMultiCriteria:
    """Test multi-criteria functionality."""
    
    def test_list_presets(self):
        """Test listing multi-criteria presets."""
        presets = list_multi_criteria_presets()
        assert len(presets) > 0
        assert all("id" in p for p in presets)
        assert all("description" in p for p in presets)
    
    def test_get_preset(self):
        """Test getting a specific preset."""
        query = get_multi_criteria_preset("elite_performers")
        assert query is not None
        assert len(query.rules) > 0
        assert query.logic in ["AND", "OR", "WEIGHTED"]
    
    def test_create_multi_criteria_intersection(self):
        """Test creating intersection multi-criteria."""
        query = create_multi_criteria_query(
            rules=[
                {"template_id": "top_teams_by_score", "params": {"limit": 10}},
                {"template_id": "first_blood_hunters", "params": {"min_count": 2}}
            ],
            logic="AND",
            combine_method="intersection"
        )
        
        assert len(query.rules) == 2
        assert query.logic == "AND"
        assert query.combine_method == "intersection"
    
    def test_create_multi_criteria_union(self):
        """Test creating union multi-criteria."""
        query = create_multi_criteria_query(
            rules=[
                {"template_id": "top_teams_by_score", "params": {"limit": 5}},
                {"template_id": "solve_count_champions", "params": {"limit": 5}}
            ],
            logic="OR",
            combine_method="union"
        )
        
        assert len(query.rules) == 2
        assert query.logic == "OR"
        assert query.combine_method == "union"
    
    def test_create_multi_criteria_weighted(self):
        """Test creating weighted multi-criteria."""
        query = create_multi_criteria_query(
            rules=[
                {"template_id": "top_teams_by_score", "params": {"limit": 50}, "weight": 0.5},
                {"template_id": "solve_count_champions", "params": {"limit": 50}, "weight": 0.3},
                {"template_id": "first_blood_hunters", "params": {"limit": 50}, "weight": 0.2}
            ],
            logic="WEIGHTED",
            combine_method="weighted_score"
        )
        
        assert len(query.rules) == 3
        assert query.rules[0].weight == 0.5
        assert query.rules[1].weight == 0.3
        assert query.rules[2].weight == 0.2


class TestTemplateValidation:
    """Test template validation and edge cases."""
    
    def test_all_templates_valid_structure(self):
        """Ensure all templates have required fields."""
        templates = list_templates()
        
        for t in templates:
            assert hasattr(t, "id")
            assert hasattr(t, "name")
            assert hasattr(t, "description")
            assert hasattr(t, "category")
            assert hasattr(t, "icon")
            assert hasattr(t, "query_config")
            assert hasattr(t, "customizable_params")
            assert hasattr(t, "example_usage")
            
            # Query config must have entity and metric
            assert "entity" in t.query_config
            assert "metric" in t.query_config
    
    def test_template_categories_valid(self):
        """Ensure all templates have valid categories."""
        valid_categories = {"ranking", "achievement", "special"}
        templates = list_templates()
        
        for t in templates:
            assert t.category in valid_categories
    
    def test_template_entities_valid(self):
        """Ensure all templates use valid entities."""
        valid_entities = {"team", "user", "solve"}
        templates = list_templates()
        
        for t in templates:
            assert t.query_config["entity"] in valid_entities
    
    def test_query_build_with_empty_params(self):
        """Test building query with empty params."""
        query = build_query_from_template("top_teams_by_score", {})
        assert query is not None
        assert query["limit"] == 50  # Default limit


# Integration tests (require database)
class TestIntegration:
    """Integration tests - require active CTFd database."""
    
    @pytest.mark.integration
    def test_execute_simple_query(self):
        """Test executing a simple query (requires DB)."""
        from CTFd.utils.rewards.query_engine import execute_query, validate_query_spec
        
        query = build_query_from_template(
            "top_teams_by_score",
            {"limit": 5}
        )
        
        spec = validate_query_spec(query)
        result = execute_query(spec)
        
        assert "result" in result
        assert "generated_sql" in result
        assert isinstance(result["result"], list)
    
    @pytest.mark.integration
    def test_execute_multi_criteria(self):
        """Test executing multi-criteria query (requires DB)."""
        query = get_multi_criteria_preset("elite_performers")
        executor = MultiCriteriaExecutor(query)
        
        result = executor.execute()
        
        assert "result" in result
        assert "description" in result
        assert "total_matched" in result
        assert isinstance(result["result"], list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
