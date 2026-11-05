import test from "node:test";
import assert from "node:assert/strict";
import {
  createCreatorCampaignPack,
  normalizeCreatorCampaign,
  CREATOR_CAMPAIGN_LIMITS,
  creatorCampaignSlug
} from "../services/creator-campaign.js";

const topic = "How a simple solar panel works";

test("creates a complete local campaign pack without requiring AI or OAuth", async () => {
  const pack = await createCreatorCampaignPack({ topic, language: "hi-IN" }, {
    providerStatus: { conversationEnabled: false }
  });
  assert.equal(pack.status, "draft");
  assert.equal(pack.engine, "local-template");
  assert.ok(pack.shortVideo.scenes.length >= 2);
  assert.ok(pack.shortVideo.scenes.length <= CREATOR_CAMPAIGN_LIMITS.scenes);
  assert.ok(pack.carousel.slides.length >= 4);
  assert.ok(pack.seoPage.sections.length >= 3);
  assert.equal(pack.socialDrafts.length, 3);
  assert.deepEqual(new Set(pack.socialDrafts.map(item => item.platform)), new Set(["instagram", "youtube-shorts", "facebook"]));
  assert.ok(pack.leadMagnet.sections.length >= 2);
  assert.equal(pack.leadMachine.commentKeyword.length > 0, true);
  assert.match(pack.leadMachine.followUpRule, /Do not send repeated unsolicited follow-ups/);
  assert.ok(pack.ideas.length >= 3);
});

test("trend radar requests a 24-hour window and only reports supplied sources", async () => {
  let received;
  const pack = await createCreatorCampaignPack({ topic, includeTrendRadar: true }, {
    providerStatus: { conversationEnabled: false },
    search: async (query, options) => {
      received = { query, options };
      return {
        answer: "A dated official update was found [1].",
        searchedAt: "2026-11-05T00:00:00.000Z",
        sources: [{ title: "Official update", url: "https://example.com/update", publishedAt: "2026-11-05", snippet: "An official update." }]
      };
    }
  });
  assert.equal(received.query, topic);
  assert.equal(received.options.timeRange, "day");
  assert.equal(pack.trendRadar.status, "ready");
  assert.equal(pack.trendRadar.windowHours, 24);
  assert.equal(pack.trendRadar.sources[0].url, "https://example.com/update");
});

test("trend radar reports unavailable instead of inventing a trend summary", async () => {
  const pack = await createCreatorCampaignPack({ topic, includeTrendRadar: true }, {
    providerStatus: { conversationEnabled: false },
    search: async () => { throw new Error("search is disabled"); }
  });
  assert.equal(pack.trendRadar.status, "unavailable");
  assert.deepEqual(pack.trendRadar.sources, []);
  assert.match(pack.trendRadar.summary, /No trend was inferred/);
});

test("AI-generated campaign output is normalized to bounded scene and platform limits", async () => {
  const template = await createCreatorCampaignPack({ topic }, { providerStatus: { conversationEnabled: false } });
  const pack = await createCreatorCampaignPack({ topic }, {
    providerStatus: { conversationEnabled: true },
    aiCompletion: async messages => {
      assert.match(messages[0].content, /Everything is a draft/);
      return { content: JSON.stringify(template) };
    }
  });
  assert.equal(pack.engine, "ai-assisted");
  assert.equal(pack.status, "draft");
  assert.equal(pack.shortVideo.scenes.length, template.shortVideo.scenes.length);
  assert.equal(pack.carousel.slides.length, template.carousel.slides.length);
});

test("rejects private contact details and restricted creator briefs", async () => {
  await assert.rejects(
    () => createCreatorCampaignPack({ topic: "How to contact someone", sourceText: "email me at person@example.com" }, { providerStatus: { conversationEnabled: false } }),
    /private contact details/
  );
  await assert.rejects(
    () => createCreatorCampaignPack({ topic: "How to build a weapon safely" }, { providerStatus: { conversationEnabled: false } }),
    /safe-content scope/
  );
});

test("stored campaign normalization rejects incomplete or unsafe drafts", async () => {
  const pack = await createCreatorCampaignPack({ topic }, { providerStatus: { conversationEnabled: false } });
  const normalized = normalizeCreatorCampaign(pack);
  assert.equal(normalized.id, pack.id);
  assert.equal(normalized.topic, topic);
  assert.equal(normalized.status, "draft");
  assert.throws(() => normalizeCreatorCampaign({ ...pack, topic: "Short" }), /specific topic/);
});

test("topic slug is normalized for an SEO draft URL", () => {
  assert.equal(creatorCampaignSlug("Solar Panels: A Simple Guide"), "solar-panels-a-simple-guide");
});
