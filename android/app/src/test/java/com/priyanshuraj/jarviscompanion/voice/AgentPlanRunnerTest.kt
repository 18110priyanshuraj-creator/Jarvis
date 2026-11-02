package com.priyanshuraj.jarviscompanion.voice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentPlanRunnerTest {
    @Test
    fun validatesAndPreviewsAUsableSearchPlan() {
        val plan = JSONObject(
            """
            {
              "mode": "device_action",
              "reply": "I will open Chrome and search for JEE Physics.",
              "actions": [
                {"type":"open_app","value":"Chrome","purpose":"Open the requested app."},
                {"type":"verify_app_foreground","value":"Chrome","purpose":"Confirm the requested app is foregrounded."},
                {"type":"tap_label","value":"Search","purpose":"Open visible search."},
                {"type":"type_text","value":"JEE Physics","purpose":"Enter search phrase."},
                {"type":"verify_screen_text","value":"JEE Physics","purpose":"Confirm the expected query is visible."},
                {"type":"ask_user","value":"Choose the result yourself.","purpose":"Keep result choice with the user."}
              ]
            }
            """.trimIndent()
        )

        val actions = AgentPlanRunner.validate(plan)
        assertEquals(6, actions.length())
        assertTrue(AgentPlanRunner.describe(plan).contains("Open Chrome"))
        assertEquals(
            "open app → verify app → tap label → type text → verify screen → ask user",
            AgentPlanRunner.actionKinds(plan)
        )
    }

    @Test
    fun localGoogleSearchPlanSupportsWakeWordEnglishHindiAndRestrictedQueryClarification() {
        val english = LocalCommandProcessor.createGoogleSearchPlan(
            "Jarvis, search latest AI research on Google"
        )
        assertNotNull(english)
        assertEquals("device_action", english!!.optString("mode"))
        assertEquals(
            listOf("open_web_search", "verify_browser_foreground", "ask_user"),
            (0 until english.getJSONArray("actions").length()).map {
                english.getJSONArray("actions").getJSONObject(it).optString("type")
            }
        )
        assertEquals(
            "latest AI research",
            english.getJSONArray("actions").getJSONObject(0).optString("value")
        )

        val hindi = LocalCommandProcessor.createGoogleSearchPlan(
            "Jarvis, Google par JEE Main 2027 notification search karo"
        )
        assertNotNull(hindi)
        assertEquals("JEE Main 2027 notification",
            hindi!!.getJSONArray("actions").getJSONObject(0).optString("value"))

        val restricted = LocalCommandProcessor.createGoogleSearchPlan(
            "Google par alcohol ke baare mein search karo"
        )
        assertNotNull(restricted)
        assertEquals("clarification", restricted!!.optString("mode"))
        assertEquals(0, restricted.getJSONArray("actions").length())
        assertNull(LocalCommandProcessor.createGoogleSearchPlan("Open YouTube"))
    }

    @Test
    fun validatesAndPreviewsGoogleSearchHandoffWithBrowserForegroundCheck() {
        val plan = JSONObject(
            """{"mode":"device_action","reply":"Open Google in the default browser.","actions":[
                {"type":"open_web_search","value":"latest AI research","purpose":"Open Google search."},
                {"type":"verify_browser_foreground","value":"latest AI research","purpose":"Confirm the browser is foregrounded."},
                {"type":"ask_user","value":"Choose a public result manually.","purpose":"User selects the result."}
            ]}"""
        )
        val actions = AgentPlanRunner.validate(plan)
        assertEquals(3, actions.length())
        assertTrue(AgentPlanRunner.describe(plan).contains("Open Google search"))
        assertEquals("open web search → verify browser → ask user", AgentPlanRunner.actionKinds(plan))
        assertTrue(AgentPlanRunner.requiresAccessibility(plan))
    }

    @Test
    fun rejectsGoogleSearchPlansWithoutMatchingBrowserCheckOrWithUnsafeTerms() {
        val missingCheck = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_web_search","value":"latest AI research"},
                {"type":"ask_user","value":"Choose a result."}
            ]}"""
        )
        val mismatchedCheck = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_web_search","value":"latest AI research"},
                {"type":"verify_browser_foreground","value":"another query"}
            ]}"""
        )
        val secretQuery = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_web_search","value":"123456"},
                {"type":"verify_browser_foreground","value":"123456"}
            ]}"""
        )
        expectIllegalArgument { AgentPlanRunner.validate(missingCheck) }
        expectIllegalArgument { AgentPlanRunner.validate(mismatchedCheck) }
        expectIllegalArgument { AgentPlanRunner.validate(secretQuery) }
    }

    @Test
    fun rejectsProtectedScreenControlsBeforePreview() {
        val plan = JSONObject(
            """
            {
              "mode": "device_action",
              "actions": [
                {"type":"tap_label","value":"Delete account"}
              ]
            }
            """.trimIndent()
        )

        expectIllegalArgument { AgentPlanRunner.validate(plan) }
    }

    @Test
    fun rejectsSensitiveOrNumericTextBeforePreview() {
        val passwordPlan = JSONObject(
            """
            {
              "mode": "device_action",
              "actions": [
                {"type":"type_text","value":"my password is secret"}
              ]
            }
            """.trimIndent()
        )
        val numericCodePlan = JSONObject(
            """
            {
              "mode": "device_action",
              "actions": [
                {"type":"type_text","value":"123456"}
              ]
            }
            """.trimIndent()
        )

        expectIllegalArgument { AgentPlanRunner.validate(passwordPlan) }
        expectIllegalArgument { AgentPlanRunner.validate(numericCodePlan) }
    }

    @Test
    fun rejectsPermissionAndFinancialControlsUsingTheSharedPolicy() {
        listOf("Allow", "Grant permission", "Confirm transfer", "Delete account", "Card number").forEach { label ->
            val plan = JSONObject(
                """
                {
                  "mode": "device_action",
                  "actions": [
                    {"type":"tap_label","value":"$label"}
                  ]
                }
                """.trimIndent()
            )
            expectIllegalArgument { AgentPlanRunner.validate(plan) }
        }

        val cvvPlan = JSONObject(
            """
            {
              "mode": "device_action",
              "actions": [
                {"type":"type_text","value":"CVV 123"}
              ]
            }
            """.trimIndent()
        )
        expectIllegalArgument { AgentPlanRunner.validate(cvvPlan) }
    }

    @Test
    fun rejectsMissingOrOversizedActionLists() {
        expectIllegalArgument { AgentPlanRunner.validate(JSONObject()) }

        val actions = (1..7).joinToString(",") {
            """{"type":"open_app","value":"App $it"}"""
        }
        val oversized = JSONObject("""{"mode":"device_action","actions":[$actions]}""")
        expectIllegalArgument { AgentPlanRunner.validate(oversized) }
    }

    @Test
    fun classifiesConversationAndClarificationWithoutAllowingHiddenActions() {
        val conversation = JSONObject(
            """{"mode":"conversation","reply":"Here is an explanation.","actions":[]}"""
        )
        val clarification = JSONObject(
            """{"mode":"clarification","reply":"Which app do you mean?","actions":[]}"""
        )
        assertEquals(AgentPlanMode.CONVERSATION, AgentPlanRunner.mode(conversation))
        assertEquals(AgentPlanMode.CLARIFICATION, AgentPlanRunner.mode(clarification))

        val invalidConversation = JSONObject(
            """{"mode":"conversation","reply":"Opening the app.","actions":[{"type":"open_app","value":"YouTube"}]}"""
        )
        expectIllegalArgument { AgentPlanRunner.mode(invalidConversation) }
        expectIllegalArgument { AgentPlanRunner.validate(conversation) }
    }

    @Test
    fun requiresAccessibilityOnlyForActionsThatInspectOrOperateTheVisibleUi() {
        val openOnly = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_app","value":"Calculator"},
                {"type":"verify_app_foreground","value":"Calculator"}
            ]}"""
        )
        val searchPlan = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_app","value":"Chrome"},
                {"type":"verify_app_foreground","value":"Chrome"},
                {"type":"tap_label","value":"Search"},
                {"type":"type_text","value":"weather"},
                {"type":"verify_screen_text","value":"weather"}
            ]}"""
        )
        val askOnly = JSONObject(
            """{"mode":"device_action","actions":[{"type":"ask_user","value":"Choose a result manually."}]}"""
        )

        assertTrue(AgentPlanRunner.requiresAccessibility(openOnly))
        assertTrue(AgentPlanRunner.requiresAccessibility(searchPlan))
        assertFalse(AgentPlanRunner.requiresAccessibility(askOnly))
    }

    @Test
    fun rejectsPlansThatCouldFinishWithoutCheckingTheRequestedOutcome() {
        val unverifiedApp = JSONObject(
            """{"mode":"device_action","actions":[{"type":"open_app","value":"YouTube"}]}"""
        )
        val mismatchedAppCheck = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"open_app","value":"YouTube"},
                {"type":"verify_app_foreground","value":"Chrome"}
            ]}"""
        )
        val unverifiedUiMutation = JSONObject(
            """{"mode":"device_action","actions":[
                {"type":"tap_label","value":"Search"},
                {"type":"type_text","value":"JEE Physics"}
            ]}"""
        )
        expectIllegalArgument { AgentPlanRunner.validate(unverifiedApp) }
        expectIllegalArgument { AgentPlanRunner.validate(mismatchedAppCheck) }
        expectIllegalArgument { AgentPlanRunner.validate(unverifiedUiMutation) }
    }

    @Test
    fun onlyOneAndroidTaskCanOwnTheSharedExecutionGate() {
        assertFalse(AgentPlanExecutionGate.isBusy())
        assertTrue(AgentPlanExecutionGate.acquire("hands-free-task"))
        try {
            assertTrue(AgentPlanExecutionGate.isBusy())
            assertFalse(AgentPlanExecutionGate.acquire("orb-task"))
            AgentPlanExecutionGate.release("orb-task")
            assertEquals("hands-free-task", AgentPlanExecutionGate.activeIdForTests())
            assertTrue(AgentPlanExecutionGate.isBusy())
        } finally {
            AgentPlanExecutionGate.release("hands-free-task")
        }
        assertFalse(AgentPlanExecutionGate.isBusy())
    }

    private fun expectIllegalArgument(block: () -> Unit) {
        try {
            block()
            throw AssertionError("Expected plan validation to reject this input.")
        } catch (_: IllegalArgumentException) {
            // Expected: the on-device validator rejected an unsafe or invalid plan.
        }
    }
}
