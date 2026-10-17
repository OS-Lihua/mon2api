-- CreateTable
CREATE TABLE "ChainBinding" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "escrow" TEXT NOT NULL,
    "token" TEXT NOT NULL,

    CONSTRAINT "ChainBinding_pkey" PRIMARY KEY ("id")
);
