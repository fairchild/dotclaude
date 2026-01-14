#!/usr/bin/env python3
"""
Chronicle Dashboard - Edge Case Tests

Tests unusual scenarios and boundary conditions.
"""

from playwright.sync_api import sync_playwright, expect
import os
import re

SCREENSHOTS_DIR = "/tmp/chronicle-tests"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def test_rapid_worktree_switching():
    """Test: Rapidly clicking between worktrees doesn't break the UI."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")
        count = worktree_items.count()

        if count < 2:
            print("⊘ Need at least 2 worktrees - skipping")
            browser.close()
            return

        # Rapidly click between worktrees
        for _ in range(5):
            for i in range(min(count, 3)):
                worktree_items.nth(i).click()
                page.wait_for_timeout(100)

        # Wait for things to settle
        page.wait_for_timeout(500)

        # UI should still be responsive
        article = page.locator("#worktree-article")
        expect(article).to_be_visible()

        # Title should have content
        title = page.locator("#article-title").text_content()
        assert len(title) > 0, "Title should have content"

        print("✓ Rapid worktree switching handled correctly")

        browser.close()


def test_rapid_period_switching():
    """Test: Rapidly clicking period buttons doesn't break the UI."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        periods = ["daily", "weekly", "monthly"]

        # Rapidly click through periods
        for _ in range(3):
            for period in periods:
                page.locator(f'.period-btn[data-period="{period}"]').click()
                page.wait_for_timeout(50)

        page.wait_for_timeout(500)

        # UI should still work
        headline = page.locator("#headline").text_content()
        assert headline != "Loading...", "Headline should have loaded"

        print("✓ Rapid period switching handled correctly")

        browser.close()


def test_keyboard_navigation():
    """Test: Keyboard shortcuts work as expected."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Open sessions first
        page.locator("#sessions-toggle").click()
        page.wait_for_timeout(300)

        # Press / to focus search
        page.keyboard.press("/")
        page.wait_for_timeout(100)

        # Search should be focused
        search = page.locator("#search")
        assert search.evaluate("el => el === document.activeElement"), "Search should be focused"

        # Type something
        page.keyboard.type("test")
        assert search.input_value() == "test"

        # Press Escape to clear
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)

        assert search.input_value() == "", "Search should be cleared"

        print("✓ Keyboard navigation works")

        browser.close()


def test_sidebar_state_persistence():
    """Test: Sidebar collapsed state persists across page reloads."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        sidebar = page.locator(".sidebar")

        # Should start expanded
        expect(sidebar).not_to_have_class(re.compile("collapsed"))

        # Collapse it
        page.locator("#sidebar-toggle").click()
        page.wait_for_timeout(300)
        expect(sidebar).to_have_class(re.compile("collapsed"))

        # Reload the page
        page.reload()
        page.wait_for_load_state("networkidle")

        # Should still be collapsed
        expect(page.locator(".sidebar")).to_have_class(re.compile("collapsed"))

        print("✓ Sidebar state persists across reloads")

        context.close()
        browser.close()


def test_worktree_selection_persistence():
    """Test: Selected worktree state is maintained correctly."""
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

        # Select first worktree
        first_item = worktree_items.first
        first_item.click()
        page.wait_for_timeout(300)

        # Should have 'selected' class
        expect(first_item).to_have_class(re.compile("selected"))

        # Select second worktree (if exists)
        if worktree_items.count() > 1:
            second_item = worktree_items.nth(1)
            second_item.click()
            page.wait_for_timeout(300)

            # Second should be selected, first should not
            expect(second_item).to_have_class(re.compile("selected"))
            expect(first_item).not_to_have_class(re.compile("selected"))

        print("✓ Worktree selection state maintained correctly")

        browser.close()


def test_article_updates_on_worktree_switch():
    """Test: Article view updates when switching worktrees."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        worktree_items = page.locator(".worktree-item")

        if worktree_items.count() < 2:
            print("⊘ Need at least 2 worktrees - skipping")
            browser.close()
            return

        # Click first worktree
        worktree_items.first.click()
        page.wait_for_timeout(300)

        first_title = page.locator("#article-title").text_content()

        # Click second worktree
        worktree_items.nth(1).click()
        page.wait_for_timeout(300)

        second_title = page.locator("#article-title").text_content()

        # Titles should be different
        assert first_title != second_title, "Article should update for different worktrees"

        print("✓ Article updates correctly on worktree switch")

        browser.close()


def test_empty_search_shows_all():
    """Test: Empty search query shows all sessions."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        page.goto("http://localhost:3456")
        page.wait_for_load_state("networkidle")

        # Expand sessions
        page.locator("#sessions-toggle").click()
        page.wait_for_timeout(300)

        initial_count = page.locator(".session-card").count()

        if initial_count == 0:
            print("⊘ No sessions to test - skipping")
            browser.close()
            return

        # Type and then delete
        search = page.locator("#search")
        search.fill("something")
        page.wait_for_timeout(200)
        search.fill("")
        page.wait_for_timeout(200)

        final_count = page.locator(".session-card").count()
        assert final_count == initial_count, "Empty search should show all sessions"

        print("✓ Empty search shows all sessions")

        browser.close()


def run_all_tests():
    """Run all edge case tests."""
    tests = [
        test_rapid_worktree_switching,
        test_rapid_period_switching,
        test_keyboard_navigation,
        test_sidebar_state_persistence,
        test_worktree_selection_persistence,
        test_article_updates_on_worktree_switch,
        test_empty_search_shows_all,
    ]

    print("\n" + "=" * 60)
    print("Chronicle Dashboard - Edge Case Tests")
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
