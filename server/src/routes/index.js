const express = require("express");
const router = express.Router();

const syllabusController = require("../controllers/syllabusController");
const contentController = require("../controllers/contentController");
const questionController = require("../controllers/questionController");
const responseController = require("../controllers/responseController");
const progressController = require("../controllers/progressController");
const queueController = require("../controllers/queueController");

router.get("/health", (req, res) => {
	res.status(200).json({ status: "OK", message: "API is running" });
});

router.get("/syllabus", syllabusController.getSyllabus);
router.post("/syllabus/upload", syllabusController.uploadSyllabus);
router.post("/syllabus/enroll", syllabusController.enrollInSyllabus);

router.get("/content/:id",  contentController.getContentItem);
router.get("/content",      contentController.getContent);
router.post("/content",     contentController.uploadContent);
router.post("/content/adaptive", contentController.createAdaptiveContent);

router.get("/questions/:id",  questionController.getQuestionItem);
router.get("/questions",      questionController.getQuestions);
router.post("/questions",     questionController.uploadQuestions);
router.post("/questions/adaptive", questionController.createAdaptiveQuestion);

router.get("/responses", responseController.getResponses);
router.post("/responses", responseController.submitResponse);
router.patch("/responses/:id/grade",    responseController.gradeResponseHandler);
router.post("/responses/:id/grade-ai", responseController.gradeResponseAI);

router.get("/content-views", contentController.getContentViews);
router.put("/content-views", contentController.updateContentView);

router.get("/progress", progressController.getProgress);
router.get("/course-progress", progressController.getCourseProgress);
router.get("/enrollments", progressController.getEnrollments);
router.get("/struggling", progressController.getStruggling);
router.post("/generate-adaptive", progressController.generateAdaptive);

router.get("/queue",        queueController.getQueue);
router.delete("/queue/:id", queueController.deleteQueueItem);



module.exports = router;
