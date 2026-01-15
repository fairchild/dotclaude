#!/usr/bin/env python3
"""
Chronicle Dashboard - Behavioral Flow Tests

Tests the key user flows, not implementation details.
"""

from playwright.sync_api import sync_playwright, expect
import os
import re

SCREENSHOTS_DIR = "/tmp/chronicle-tests"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def test_chronicle_newspaper_view():
    """Test: User opens Chronicle and sees a newspaper-style overview."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Should see the masthead
        expect(page.locator(".masthead-title")).to_have_text("The Coding Chronicle")

        # Should see a headline (not Loading...)
        headline = page.locator("#headline")
        expect(headline).not_to_have_text("Loading...")

        # Should see period buttons
        expect(page.locator('.period-btn[data-period="weekly"]')).to_have_class(re.compile("active"))

        # Should see stats bar
        expect(page.locator("#stat-sessions")).not_to_have_text("-")

        # Should see project cards
        expect(page.locator(".project-card").first).to_be_visible()

        page.screenshot(path=f"{SCREENSHOTS_DIR}/flow_newspaper_view.png")
        print("✓ Newspaper view displays correctly")

        browser.close()


def test_period_switching():
    """Test: User can switch between daily/weekly/monthly views."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Get initial headline
        initial_headline = page.locator("#headline").text_content()

        # Switch to daily
        page.locator('.period-btn[data-period="daily"]').click()
        page.wait_for_timeout(500)

        # Verify daily button is now active
        expect(page.locator('.period-btn[data-period="daily"]')).to_have_class(re.compile("active"))

        # Switch to monthly
        page.locator('.period-btn[data-period="monthly"]').click()
        page.wait_for_timeout(500)

        expect(page.locator('.period-btn[data-period="monthly"]')).to_have_class(re.compile("active"))

        print("✓ Period switching works")

        browser.close()


def test_sidebar_shows_worktrees():
    """Test: Sidebar displays available worktrees in tree structure."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Should see sidebar
        expect(page.locator(".sidebar")).to_be_visible()

        # Should see Code nav link
        expect(page.locator("#nav-chronicle")).to_have_text("Code")

        # Should see worktree list (either items or empty message)
        worktree_list = page.locator("#worktree-list")
        expect(worktree_list).to_be_visible()

        # Should have repo groups or empty message
        has_worktrees = page.locator(".repo-group").count() > 0
        has_empty = page.locator(".sidebar-empty").count() > 0
        assert has_worktrees or has_empty, "Should show worktrees or empty message"

        if has_worktrees:
            # Should have tree connectors
            expect(page.locator(".tree-connector").first).to_be_visible()

        print("✓ Sidebar displays worktrees correctly")

        browser.close()


def test_sidebar_collapse_expand():
    """Test: User can collapse and expand the sidebar."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        sidebar = page.locator(".sidebar")
        toggle = page.locator("#sidebar-toggle")

        # Initially expanded
        expect(sidebar).not_to_have_class(re.compile("collapsed"))

        # Collapse
        toggle.click()
        page.wait_for_timeout(300)
        expect(sidebar).to_have_class(re.compile("collapsed"))

        # Worktree list should be hidden
        expect(page.locator("#worktree-list")).not_to_be_visible()

        # Expand again
        toggle.click()
        page.wait_for_timeout(300)
        expect(sidebar).not_to_have_class(re.compile("collapsed"))

        print("✓ Sidebar collapse/expand works")

        browser.close()


def test_worktree_selection_shows_article():
    """Test: Clicking a worktree shows the article view."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() == 0:
            print("⊘ No worktrees to test - skipping")
            browser.close()
            return

        # Click first worktree
        first_item = worktree_items.first
        wt_name = first_item.locator(".worktree-name").text_content().strip()
        first_item.click()
        page.wait_for_timeout(500)

        # Article view should be visible
        article = page.locator("#worktree-article")
        expect(article).to_be_visible()

        # Newspaper should be hidden
        expect(page.locator(".front-page")).not_to_be_visible()

        # Article should show worktree name
        title = page.locator("#article-title").text_content()
        assert wt_name.replace(" *", "").replace("*", "") in title or title in wt_name

        # Status bar should be visible
        expect(page.locator("#article-status")).to_be_visible()

        page.screenshot(path=f"{SCREENSHOTS_DIR}/flow_article_view.png")
        print(f"✓ Worktree article view shows for '{title}'")

        browser.close()


def test_chronicle_link_returns_to_newspaper():
    """Test: Clicking 'Code' link returns to newspaper view."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() == 0:
            print("⊘ No worktrees to test - skipping")
            browser.close()
            return

        # Go to article view
        worktree_items.first.click()
        page.wait_for_timeout(500)
        expect(page.locator("#worktree-article")).to_be_visible()

        # Click Code link
        page.locator("#nav-chronicle").click()
        page.wait_for_timeout(300)

        # Should be back to newspaper
        expect(page.locator(".front-page")).to_be_visible()
        expect(page.locator("#worktree-article")).not_to_be_visible()

        print("✓ Code link returns to newspaper view")

        browser.close()


def test_article_back_link():
    """Test: Article breadcrumb back link returns to newspaper."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() == 0:
            print("⊘ No worktrees to test - skipping")
            browser.close()
            return

        # Go to article view
        worktree_items.first.click()
        page.wait_for_timeout(500)

        # Click back link
        page.locator("#article-back").click()
        page.wait_for_timeout(300)

        # Should be back to newspaper
        expect(page.locator(".front-page")).to_be_visible()

        print("✓ Article back link works")

        browser.close()


def test_project_card_expansion():
    """Test: Clicking project card header expands/collapses details."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        cards = page.locator(".project-card")

        if cards.count() == 0:
            print("⊘ No project cards to test - skipping")
            browser.close()
            return

        first_card = cards.first

        # Initially collapsed
        expect(first_card).not_to_have_class(re.compile("expanded"))

        # Click to expand
        first_card.locator(".project-header").click()
        page.wait_for_timeout(300)

        expect(first_card).to_have_class(re.compile("expanded"))
        expect(first_card.locator(".project-details")).to_be_visible()

        # Click again to collapse
        first_card.locator(".project-header").click()
        page.wait_for_timeout(300)

        expect(first_card).not_to_have_class(re.compile("expanded"))

        print("✓ Project card expansion works")

        browser.close()


def test_sessions_list_toggle():
    """Test: Sessions section expands when clicked."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        sessions_toggle = page.locator("#sessions-toggle")
        sessions_list = page.locator("#sessions-list")

        # Initially closed
        expect(sessions_list).not_to_have_class(re.compile("open"))

        # Click to open
        sessions_toggle.click()
        page.wait_for_timeout(300)

        expect(sessions_list).to_have_class(re.compile("open"))
        expect(page.locator("#search")).to_be_visible()

        print("✓ Sessions list toggle works")

        browser.close()


def test_session_search():
    """Test: Search filters session list."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Expand sessions
        page.locator("#sessions-toggle").click()
        page.wait_for_timeout(300)

        # Count initial sessions
        initial_count = page.locator(".session-card").count()

        if initial_count == 0:
            print("⊘ No sessions to search - skipping")
            browser.close()
            return

        # Search for something specific
        search = page.locator("#search")
        search.fill("xyznonexistent")
        page.wait_for_timeout(300)

        # Should have fewer (likely 0) results
        filtered_count = page.locator(".session-card").count()
        assert filtered_count <= initial_count

        # Clear with Escape
        search.press("Escape")
        page.wait_for_timeout(200)

        # Should be back to original
        restored_count = page.locator(".session-card").count()
        assert restored_count == initial_count

        print("✓ Session search works")

        browser.close()


def test_article_has_action_buttons():
    """Test: Article view has all three action buttons."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() == 0:
            print("⊘ No worktrees to test - skipping")
            browser.close()
            return

        # Go to article view
        worktree_items.first.click()
        page.wait_for_timeout(500)

        # Should have all three action buttons
        expect(page.locator("#article-open-editor")).to_be_visible()
        expect(page.locator("#article-open-terminal")).to_be_visible()
        expect(page.locator("#article-archive")).to_be_visible()

        # Archive button should have distinct styling (red border)
        archive_btn = page.locator("#article-archive")
        expect(archive_btn).to_have_text("Archive")

        print("✓ Article has all action buttons including Archive")

        browser.close()


def test_empty_worktree_shows_message():
    """Test: Worktree with no chronicle data shows empty state."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Find a worktree - we'll check if empty state shows when no chronicle
        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() == 0:
            print("⊘ No worktrees to test - skipping")
            browser.close()
            return

        # Click first worktree
        worktree_items.first.click()
        page.wait_for_timeout(500)

        # Either content sections or empty state should be visible
        has_summary = page.locator("#article-summary-section").is_visible()
        has_pending = page.locator("#article-pending-section").is_visible()
        has_accomplished = page.locator("#article-accomplished-section").is_visible()
        has_empty = page.locator("#article-empty").is_visible()

        has_content = has_summary or has_pending or has_accomplished

        assert has_content or has_empty, "Should show either content or empty state"

        if has_empty:
            expect(page.locator("#article-empty")).to_contain_text("No Chronicle entries")
            page.screenshot(path=f"{SCREENSHOTS_DIR}/flow_empty_state.png")
            print("✓ Empty state displays correctly")
        else:
            print("✓ Article has content (empty state not needed)")

        browser.close()


def run_all_tests():
    """Run all behavioral tests."""
    tests = [
        test_chronicle_newspaper_view,
        test_period_switching,
        test_sidebar_shows_worktrees,
        test_sidebar_collapse_expand,
        test_worktree_selection_shows_article,
        test_chronicle_link_returns_to_newspaper,
        test_article_back_link,
        test_article_has_action_buttons,
        test_project_card_expansion,
        test_sessions_list_toggle,
        test_session_search,
        test_empty_worktree_shows_message,
    ]

    print("\n" + "=" * 60)
    print("Chronicle Dashboard - Behavioral Flow Tests")
    print("=" * 60 + "\n")

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"✗ {test.__name__}: {e}")
            failed += 1

    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60 + "\n")

    return failed == 0


if __name__ == "__main__":
    import sys
    success = run_all_tests()
    sys.exit(0 if success else 1)
